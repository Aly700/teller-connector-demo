import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
}

export class DataStack extends cdk.Stack {
  readonly database: rds.DatabaseInstance;
  readonly databaseSecret: secretsmanager.Secret;
  readonly apiKeySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: 'teller-database-credentials',
      description: 'Teller database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'teller_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 40,
      },
    });
    this.databaseSecret.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    this.apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      secretName: 'teller-api-key',
      description: 'Teller static API credential',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        passwordLength: 48,
      },
    });
    this.apiKeySecret.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    this.database = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier: 'teller-database',
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publiclyAccessible: false,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_13,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      databaseName: 'teller',
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 40,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(1),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deleteAutomatedBackups: true,
    });
  }
}
