FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
COPY src/ src/
COPY console/dist/ console/dist/
RUN chmod +x mvnw && (./mvnw -o -q -DskipTests package || ./mvnw -q -DskipTests package)

FROM eclipse-temurin:21-jre-jammy
RUN groupadd --system teller && useradd --system --gid teller --home-dir /app teller
WORKDIR /app
COPY --from=build --chown=teller:teller /workspace/target/teller-*.jar app.jar
USER teller:teller
EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xshare:auto", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
