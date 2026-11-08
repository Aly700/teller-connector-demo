package dev.affan.teller;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@Testcontainers(disabledWithoutDocker = true)
public abstract class LocalStackIntegrationTest {

    protected static final String QUEUE_NAME = "teller-integration-approvals";
    protected static final String BUCKET_NAME = "teller-integration-audit";

    @Container
    protected static final LocalStackContainer LOCALSTACK =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:3"))
                    .withServices(LocalStackContainer.Service.SQS, LocalStackContainer.Service.S3);

    @DynamicPropertySource
    static void configureAwsSdk(DynamicPropertyRegistry registry) {
        registry.add("teller.aws.region", LOCALSTACK::getRegion);
        registry.add("teller.aws.endpoint", LOCALSTACK::getEndpoint);
        registry.add("teller.aws.credentials.access-key", LOCALSTACK::getAccessKey);
        registry.add("teller.aws.credentials.secret-key", LOCALSTACK::getSecretKey);
        registry.add("teller.aws.sqs.queue-url", () ->
                LOCALSTACK.getEndpoint() + "/000000000000/" + QUEUE_NAME);
        registry.add("teller.aws.s3.bucket", () -> BUCKET_NAME);
        registry.add("teller.aws.s3.path-style-access-enabled", () -> true);
    }
}
