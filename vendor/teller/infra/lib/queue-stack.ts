import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class QueueStack extends cdk.Stack {
  readonly approvalQueue: sqs.Queue;
  readonly approvalDeadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.approvalDeadLetterQueue = new sqs.Queue(this, 'ApprovalDeadLetterQueue', {
      queueName: 'teller-approvals-dlq',
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.approvalQueue = new sqs.Queue(this, 'ApprovalQueue', {
      queueName: 'teller-approvals',
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.approvalDeadLetterQueue,
        maxReceiveCount: 5,
      },
    });
  }
}
