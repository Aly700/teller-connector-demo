import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ServiceStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly database: rds.DatabaseInstance;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly apiKeySecret: secretsmanager.ISecret;
  readonly approvalQueue: sqs.IQueue;
  readonly approvalDeadLetterQueue: sqs.IQueue;
  readonly auditBucket: s3.IBucket;
  readonly imageTag: string;
}

export class ServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const repository = ecr.Repository.fromRepositoryName(this, 'Repository', 'teller');
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      clusterName: 'teller-cluster',
    });
    const logGroup = new logs.LogGroup(this, 'ApplicationLogs', {
      logGroupName: 'teller-application',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'teller-task',
      cpu: Number(this.node.tryGetContext('taskCpu') ?? 256),
      memoryLimitMiB: Number(this.node.tryGetContext('taskMemory') ?? 512),
    });

    const container = taskDefinition.addContainer('Application', {
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'teller',
      }),
      environment: {
        DB_URL: `jdbc:postgresql://${props.database.dbInstanceEndpointAddress}:${props.database.dbInstanceEndpointPort}/teller`,
        AWS_REGION: cdk.Stack.of(this).region,
        TELLER_AWS_ENABLED: 'true',
        AUDIT_EXPORT_ENABLED: 'true',
        APPROVAL_QUEUE_URL: props.approvalQueue.queueUrl,
        APPROVAL_DLQ_URL: props.approvalDeadLetterQueue.queueUrl,
        APPROVAL_WORKER_ENABLED: 'true',
        SQS_WAIT_TIME_SECONDS: '20',
        AUDIT_BUCKET: props.auditBucket.bucketName,
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(props.databaseSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.databaseSecret, 'password'),
        TELLER_API_KEY: ecs.Secret.fromSecretsManager(props.apiKeySecret, 'apiKey'),
      },
    });
    container.addPortMappings({ containerPort: 8080 });

    props.approvalQueue.grantSendMessages(taskDefinition.taskRole);
    props.approvalQueue.grantConsumeMessages(taskDefinition.taskRole);
    props.approvalDeadLetterQueue.grantConsumeMessages(taskDefinition.taskRole);
    taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [
        props.auditBucket.arnForObjects('audit/*'),
        props.auditBucket.arnForObjects('entries/*'),
      ],
    }));
    props.apiKeySecret.grantRead(taskDefinition.taskRole);

    const service = new ecs.FargateService(this, 'Service', {
      serviceName: 'teller-service',
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
      enableExecuteCommand: false,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    service.connections.allowFrom(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8080),
      'Public API access without an ALB',
    );
    new ec2.CfnSecurityGroupIngress(this, 'DatabaseIngress', {
      groupId: props.database.connections.securityGroups[0].securityGroupId,
      sourceSecurityGroupId: service.connections.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      description: 'Teller database access',
    });

    const serverErrors = new logs.MetricFilter(this, 'ServerErrorMetricFilter', {
      logGroup,
      metricNamespace: 'Teller',
      metricName: 'Http5xxCount',
      filterPattern: logs.FilterPattern.literal('"event=http_request" "status=5*"'),
      metricValue: '1',
      defaultValue: 0,
    });
    new cloudwatch.Alarm(this, 'ServerErrorAlarm', {
      alarmName: 'teller-http-5xx',
      metric: serverErrors.metric({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Teller emitted at least five HTTP 5xx responses in five minutes',
    });

    const dlqDepth = props.approvalDeadLetterQueue.metricApproximateNumberOfMessagesVisible({
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    });
    new cloudwatch.Alarm(this, 'DlqDepthAlarm', {
      alarmName: 'teller-approval-dlq-depth',
      metric: dlqDepth,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'At least one Teller approval message requires DLQ inspection and replay',
    });

    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: 'Teller',
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({ title: 'HTTP 5xx count', left: [serverErrors.metric({ statistic: 'Sum' })] }),
      new cloudwatch.GraphWidget({ title: 'Approval DLQ depth', left: [dlqDepth] }),
      new cloudwatch.GraphWidget({
        title: 'ECS CPU and memory',
        left: [
          service.metricCpuUtilization({ period: cdk.Duration.minutes(1) }),
          service.metricMemoryUtilization({ period: cdk.Duration.minutes(1) }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS CPU and connections',
        left: [
          props.database.metricCPUUtilization({ period: cdk.Duration.minutes(1) }),
          props.database.metricDatabaseConnections({ period: cdk.Duration.minutes(1) }),
        ],
      }),
    );
  }
}
