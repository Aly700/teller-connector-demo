package dev.affan.teller.web;

import dev.affan.teller.sqs.DlqReplayService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/admin")
@ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
public class AdminController {

    private final DlqReplayService dlqReplayService;

    public AdminController(DlqReplayService dlqReplayService) {
        this.dlqReplayService = dlqReplayService;
    }

    @PostMapping("/dlq/replay")
    ReplayResponse replay(
            @RequestParam(defaultValue = "10") @Min(1) @Max(10) int limit) {
        return new ReplayResponse(dlqReplayService.replay(limit));
    }

    record ReplayResponse(int replayed) {
    }
}
