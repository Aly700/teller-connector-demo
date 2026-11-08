package dev.affan.teller.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ConsoleControllerTest {

    @Test
    void forwardsTheConsoleRootToThePackagedViteIndex() throws Exception {
        MockMvcBuilders.standaloneSetup(new ConsoleController()).build()
                .perform(get("/console/"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/console/index.html"));
    }
}
