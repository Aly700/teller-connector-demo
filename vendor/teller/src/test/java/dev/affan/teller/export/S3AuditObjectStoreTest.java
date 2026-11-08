package dev.affan.teller.export;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.config.AwsProperties;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;

class S3AuditObjectStoreTest {

    @Test
    void refreshesTheDeterministicDailyObjectOnRepeatedExport() {
        List<PutObjectRequest> requests = new ArrayList<>();
        S3Client client = (S3Client) Proxy.newProxyInstance(
                S3Client.class.getClassLoader(),
                new Class<?>[] {S3Client.class},
                (proxy, method, arguments) -> {
                    if (method.getName().equals("putObject")) {
                        requests.add((PutObjectRequest) arguments[0]);
                        return PutObjectResponse.builder().build();
                    }
                    if (method.getName().equals("serviceName")) {
                        return "s3";
                    }
                    if (method.getName().equals("close")) {
                        return null;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
        AwsProperties properties = new AwsProperties();
        properties.getS3().setBucket("audit-bucket");
        S3AuditObjectStore store = new S3AuditObjectStore(client, properties);

        store.put("audit/dt=2026-08-28/20260828T000000Z.jsonl", "first\n".getBytes());
        store.put("audit/dt=2026-08-28/20260828T000000Z.jsonl", "second\n".getBytes());

        assertThat(requests).hasSize(2).allSatisfy(request -> {
            assertThat(request.bucket()).isEqualTo("audit-bucket");
            assertThat(request.ifNoneMatch()).isNull();
        });
    }
}
