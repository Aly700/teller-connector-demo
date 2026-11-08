package dev.affan.teller.export;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "false", matchIfMissing = true)
public class DisabledAuditObjectStore implements AuditObjectStore {

    @Override
    public void put(String objectKey, byte[] jsonLines) {
        throw new ExportUnavailableException("S3 audit export is disabled");
    }

    @Override
    public byte[] get(String objectKey) {
        throw new ExportUnavailableException("S3 audit export is disabled");
    }
}
