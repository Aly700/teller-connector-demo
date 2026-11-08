package dev.affan.teller;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
		"teller.api-key=test-key",
		"teller.aws.enabled=false"
})
class TellerApplicationTests {

	@Test
	void contextLoads() {
	}

}
