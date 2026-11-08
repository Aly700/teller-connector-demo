package dev.affan.teller.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.SqsClientBuilder;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AwsProperties.class)
public class AwsClientConfiguration {

    @Bean
    @ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
    SqsClient sqsClient(AwsProperties properties) {
        SqsClientBuilder builder = SqsClient.builder()
                .region(region(properties))
                .credentialsProvider(credentialsProvider(properties))
                .httpClientBuilder(ApacheHttpClient.builder());
        if (properties.getEndpoint() != null) {
            builder.endpointOverride(properties.getEndpoint());
        }
        return builder.build();
    }

    @Bean
    @ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
    S3Client s3Client(AwsProperties properties) {
        S3ClientBuilder builder = S3Client.builder()
                .region(region(properties))
                .credentialsProvider(credentialsProvider(properties))
                .serviceConfiguration(s3ServiceConfiguration(properties))
                .httpClientBuilder(ApacheHttpClient.builder());
        if (properties.getEndpoint() != null) {
            builder.endpointOverride(properties.getEndpoint());
        }
        return builder.build();
    }

    Region region(AwsProperties properties) {
        if (!StringUtils.hasText(properties.getRegion())) {
            throw new IllegalStateException("teller.aws.region must be configured when AWS is enabled");
        }
        return Region.of(properties.getRegion());
    }

    AwsCredentialsProvider credentialsProvider(AwsProperties properties) {
        String accessKey = properties.getCredentials().getAccessKey();
        String secretKey = properties.getCredentials().getSecretKey();
        boolean hasAccessKey = StringUtils.hasText(accessKey);
        boolean hasSecretKey = StringUtils.hasText(secretKey);
        if (hasAccessKey != hasSecretKey) {
            throw new IllegalStateException(
                    "teller.aws.credentials.access-key and secret-key must be configured together");
        }
        if (hasAccessKey) {
            return StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey));
        }
        return DefaultCredentialsProvider.create();
    }

    S3Configuration s3ServiceConfiguration(AwsProperties properties) {
        return S3Configuration.builder()
                .pathStyleAccessEnabled(properties.getS3().isPathStyleAccessEnabled())
                .build();
    }
}
