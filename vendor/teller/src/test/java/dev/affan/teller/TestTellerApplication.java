package dev.affan.teller;

import org.springframework.boot.SpringApplication;

public class TestTellerApplication {

	public static void main(String[] args) {
		SpringApplication.from(TellerApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
