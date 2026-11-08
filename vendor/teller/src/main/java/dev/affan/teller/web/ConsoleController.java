package dev.affan.teller.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class ConsoleController {

    @GetMapping({"/console", "/console/"})
    String index() {
        return "forward:/console/index.html";
    }
}
