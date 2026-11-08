import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface BudgetStackProps extends cdk.StackProps {
  readonly notificationEmail: string;
}

export class BudgetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'teller-monthly',
        budgetLimit: { amount: 10, unit: 'USD' },
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              address: props.notificationEmail,
              subscriptionType: 'EMAIL',
            },
          ],
        },
      ],
    });
  }
}
