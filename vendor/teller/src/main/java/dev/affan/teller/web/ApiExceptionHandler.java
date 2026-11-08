package dev.affan.teller.web;

import dev.affan.teller.domain.ConflictException;
import dev.affan.teller.domain.InvalidApprovalTransitionException;
import dev.affan.teller.domain.InvalidTransferTransitionException;
import dev.affan.teller.domain.InsufficientFundsException;
import dev.affan.teller.domain.ResourceNotFoundException;
import dev.affan.teller.export.ExportUnavailableException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail validation(MethodArgumentNotValidException exception) {
        ProblemDetail problem = problem(HttpStatus.BAD_REQUEST, "Validation failed", "Request validation failed.");
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError error : exception.getBindingResult().getFieldErrors()) {
            errors.putIfAbsent(error.getField(), error.getDefaultMessage());
        }
        problem.setProperty("errors", errors);
        return problem;
    }

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class,
            IllegalArgumentException.class
    })
    ProblemDetail badRequest(Exception exception) {
        return problem(HttpStatus.BAD_REQUEST, "Invalid request", safeMessage(exception));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ProblemDetail notFound(ResourceNotFoundException exception) {
        return problem(HttpStatus.NOT_FOUND, "Not found", exception.getMessage());
    }

    @ExceptionHandler({
            ConflictException.class,
            InvalidApprovalTransitionException.class,
            InvalidTransferTransitionException.class,
            InsufficientFundsException.class,
            DataIntegrityViolationException.class
    })
    ProblemDetail conflict(Exception exception) {
        return problem(HttpStatus.CONFLICT, "Conflict", safeMessage(exception));
    }

    @ExceptionHandler(ExportUnavailableException.class)
    ProblemDetail serviceUnavailable(ExportUnavailableException exception) {
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "Export unavailable", exception.getMessage());
    }

    private static ProblemDetail problem(HttpStatus status, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(title);
        return problem;
    }

    private static String safeMessage(Exception exception) {
        if (exception instanceof HttpMessageNotReadableException) {
            return "The request body is malformed or contains an unsupported value.";
        }
        if (exception instanceof DataIntegrityViolationException) {
            return "The requested resource conflicts with existing data.";
        }
        return exception.getMessage();
    }
}
