package dev.affan.teller.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class IdempotencyKeyFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "Idempotency-Key";
    public static final String REQUEST_ATTRIBUTE = "teller.idempotency-key";
    private static final int MAX_KEY_LENGTH = 200;

    private final ObjectMapper objectMapper;

    public IdempotencyKeyFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!"POST".equals(request.getMethod())) {
            return true;
        }
        return !"/decisions".equals(request.getRequestURI())
                && !"/transfers".equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String key = request.getHeader(HEADER_NAME);
        if (key == null || key.isBlank() || key.length() > MAX_KEY_LENGTH) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    HttpStatus.BAD_REQUEST,
                    "A non-blank Idempotency-Key header of at most 200 characters is required.");
            problem.setTitle("Invalid request");
            response.setStatus(HttpStatus.BAD_REQUEST.value());
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            objectMapper.writeValue(response.getWriter(), problem);
            return;
        }
        request.setAttribute(REQUEST_ATTRIBUTE, key);
        filterChain.doFilter(request, response);
    }
}
