import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
const GITHUB_REPOSITORY_SUBJECT = 'repo:Aly700/teller:ref:refs/heads/main';
const GITHUB_REPOSITORY_SUBJECT_WITH_IDS = GITHUB_REPOSITORY_SUBJECT.replace(/^repo:([^/]+)\/([^:]+):/, 'repo:$1@*/$2@*:');

export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const existingProviderArn = this.node.tryGetContext('oidcProviderArn') as string | undefined;
    const provider = existingProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GithubOidcProvider',
          existingProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
          url: GITHUB_OIDC_URL,
          clientIds: ['sts.amazonaws.com'],
        });

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'teller-github-deploy',
      description: 'GitHub Actions deployment role for Teller main',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
        },
        // GitHub now issues sub claims with numeric ids (repo:OWNER@ID/REPO@ID:ref:...); accept both forms.
        StringLike: {
          [`${GITHUB_OIDC_HOST}:sub`]: [GITHUB_REPOSITORY_SUBJECT, GITHUB_REPOSITORY_SUBJECT_WITH_IDS],
        },
      }),
    });

    const repositoryArn = cdk.Stack.of(this).formatArn({
      service: 'ecr',
      resource: 'repository',
      resourceName: 'teller',
    });
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:CompleteLayerUpload',
        'ecr:CreateRepository',
        'ecr:DescribeRepositories',
        'ecr:InitiateLayerUpload',
        'ecr:PutImage',
        'ecr:UploadLayerPart',
      ],
      resources: [repositoryArn],
    }));

    const bootstrapRoleArn = cdk.Stack.of(this).formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: `cdk-*-${this.account}-${this.region}`,
    });
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [bootstrapRoleArn],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStacks', 'cloudformation:ListStacks'],
      resources: ['*'],
    }));

    new cdk.CfnOutput(this, 'GithubDeployRoleArn', {
      value: deployRole.roleArn,
      description: 'Set this ARN as the GitHub repository variable AWS_ROLE_ARN',
    });
  }
}
