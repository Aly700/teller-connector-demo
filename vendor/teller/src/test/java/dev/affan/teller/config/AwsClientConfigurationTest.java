package dev.affan.teller.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;

class AwsClientConfigurationTest {

    private final AwsClientConfiguration configuration = new AwsClientConfiguration();

    @Test
    void usesStaticCredentialsAndLocalStackClientSettingsWhenConfigured() {
        AwsProperties properties = new AwsProperties();
        properties.setRegion("us-east-1");
        properties.setEndpoint(URI.create("http://localhost:4566"));
        properties.getCredentials().setAccessKey("test");
        properties.getCredentials().setSecretKey("test");
        properties.getS3().setPathStyleAccessEnabled(true);

        StaticCredentialsProvider credentials = (StaticCredentialsProvider)
                configuration.credentialsProvider(properties);

        assertThat(configuration.region(properties)).isEqualTo(Region.US_EAST_1);
        assertThat(credentials.resolveCredentials().accessKeyId()).isEqualTo("test");
        assertThat(configuration.s3ServiceConfiguration(properties).pathStyleAccessEnabled()).isTrue();
        try (SqsClient sqsClient = configuration.sqsClient(properties);
                S3Client s3Client = configuration.s3Client(properties)) {
            assertThat(sqsClient.serviceClientConfiguration().endpointOverride())
                    .contains(URI.create("http://localhost:4566"));
            assertThat(s3Client.serviceClientConfiguration().endpointOverride())
                    .contains(URI.create("http://localhost:4566"));
        }
    }

    @Test
    void usesTheDefaultCredentialChainWhenStaticCredentialsAreAbsent() {
        AwsProperties properties = new AwsProperties();
        properties.setRegion("us-east-1");

        assertThat(configuration.credentialsProvider(properties))
                .isInstanceOf(DefaultCredentialsProvider.class);
    }

    @Test
    void rejectsPartialStaticCredentials() {
        AwsProperties properties = new AwsProperties();
        properties.getCredentials().setAccessKey("only-an-access-key");

        assertThatThrownBy(() -> configuration.credentialsProvider(properties))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("access-key and secret-key");
    }
}
