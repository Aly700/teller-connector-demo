package dev.affan.teller.export;

import dev.affan.teller.config.AwsProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;

@Component
@ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
public class S3AuditObjectStore implements AuditObjectStore {

    private final S3Client s3Client;
    private final String bucket;

    public S3AuditObjectStore(
            S3Client s3Client,
            AwsProperties properties) {
        this.s3Client = s3Client;
        this.bucket = properties.getS3().getBucket();
        if (!StringUtils.hasText(bucket)) {
            throw new IllegalStateException("teller.aws.s3.bucket must be configured when AWS is enabled");
        }
    }

    @Override
    public void put(String objectKey, byte[] jsonLines) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType("application/x-ndjson")
                .contentLength((long) jsonLines.length)
                .build();
        s3Client.putObject(request, RequestBody.fromBytes(jsonLines));
    }

    @Override
    public byte[] get(String objectKey) {
        return s3Client.getObjectAsBytes(GetObjectRequest.builder()
                        .bucket(bucket)
                        .key(objectKey)
                        .build())
                .asByteArray();
    }
}
