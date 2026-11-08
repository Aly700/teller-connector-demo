package dev.affan.teller.export;

public interface AuditObjectStore {
    void put(String objectKey, byte[] jsonLines);

    default byte[] get(String objectKey) {
        throw new ExportUnavailableException("S3 object reads are unavailable");
    }
}
