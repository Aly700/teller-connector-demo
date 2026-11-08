package dev.affan.teller.config;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("teller.aws")
public class AwsProperties {

    private boolean enabled;
    private String region;
    private URI endpoint;
    private final Credentials credentials = new Credentials();
    private final Sqs sqs = new Sqs();
    private final S3 s3 = new S3();

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getRegion() {
        return region;
    }

    public void setRegion(String region) {
        this.region = region;
    }

    public URI getEndpoint() {
        return endpoint;
    }

    public void setEndpoint(URI endpoint) {
        this.endpoint = endpoint;
    }

    public Credentials getCredentials() {
        return credentials;
    }

    public Sqs getSqs() {
        return sqs;
    }

    public S3 getS3() {
        return s3;
    }

    public static class Credentials {

        private String accessKey;
        private String secretKey;

        public String getAccessKey() {
            return accessKey;
        }

        public void setAccessKey(String accessKey) {
            this.accessKey = accessKey;
        }

        public String getSecretKey() {
            return secretKey;
        }

        public void setSecretKey(String secretKey) {
            this.secretKey = secretKey;
        }
    }

    public static class Sqs {

        private String queueUrl;
        private String dlqUrl;
        private boolean workerEnabled = true;
        private int waitTimeSeconds = 20;
        private int maxMessages = 10;
        private Duration pollInterval = Duration.ofSeconds(1);

        public String getQueueUrl() {
            return queueUrl;
        }

        public void setQueueUrl(String queueUrl) {
            this.queueUrl = queueUrl;
        }

        public String getDlqUrl() {
            return dlqUrl;
        }

        public void setDlqUrl(String dlqUrl) {
            this.dlqUrl = dlqUrl;
        }

        public boolean isWorkerEnabled() {
            return workerEnabled;
        }

        public void setWorkerEnabled(boolean workerEnabled) {
            this.workerEnabled = workerEnabled;
        }

        public int getWaitTimeSeconds() {
            return waitTimeSeconds;
        }

        public void setWaitTimeSeconds(int waitTimeSeconds) {
            this.waitTimeSeconds = waitTimeSeconds;
        }

        public int getMaxMessages() {
            return maxMessages;
        }

        public void setMaxMessages(int maxMessages) {
            this.maxMessages = maxMessages;
        }

        public Duration getPollInterval() {
            return pollInterval;
        }

        public void setPollInterval(Duration pollInterval) {
            this.pollInterval = pollInterval;
        }
    }

    public static class S3 {

        private String bucket;
        private boolean pathStyleAccessEnabled;

        public String getBucket() {
            return bucket;
        }

        public void setBucket(String bucket) {
            this.bucket = bucket;
        }

        public boolean isPathStyleAccessEnabled() {
            return pathStyleAccessEnabled;
        }

        public void setPathStyleAccessEnabled(boolean pathStyleAccessEnabled) {
            this.pathStyleAccessEnabled = pathStyleAccessEnabled;
        }
    }
}
