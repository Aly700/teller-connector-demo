#!/bin/sh
set -eu

DLQ_URL="$(awslocal sqs create-queue --queue-name teller-approvals-dlq --query QueueUrl --output text)"
DLQ_ARN="$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)"

REDRIVE_POLICY="$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"5"}' "$DLQ_ARN")"
ATTRIBUTES="$(printf '{"ReceiveMessageWaitTimeSeconds":"20","VisibilityTimeout":"30","RedrivePolicy":%s}' "$(printf '%s' "$REDRIVE_POLICY" | sed 's/"/\\"/g' | sed 's/^/"/; s/$/"/')")"

awslocal sqs create-queue \
  --queue-name teller-approvals \
  --attributes "$ATTRIBUTES" \
  >/dev/null

awslocal s3api head-bucket --bucket teller-audit 2>/dev/null \
  || awslocal s3api create-bucket --bucket teller-audit >/dev/null
