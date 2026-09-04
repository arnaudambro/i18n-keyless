import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.KotlinJvm

plugins {
    kotlin("jvm") version "2.4.10"
    `java-library`
    id("com.vanniktech.maven.publish") version "0.37.0"
}

// One shared version with the JavaScript SDKs and the other ports; it is also the wire
// `Version` header (`Version.kt`). `scripts/set-version.mjs` rewrites both lines.
group = "io.github.arnaudambro"
version = "3.6.1"

repositories {
    mavenCentral()
}

dependencies {
    // Zero runtime dependencies: the library must load in an Android app without any
    // transitive artifact, and without colliding with the JSON library the app already has.
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    // Android (minSdk 26 and up through desugaring) and every JDK a server still runs.
    jvmToolchain(17)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// Maven Central, through the Central Portal (the OSSRH staging repositories are retired).
// The plugin signs every publication when a key is configured and uploads the bundle;
// `./gradlew publishToMavenLocal` needs neither the key nor the credentials, so a release
// dry run works on any machine. Properties (PUBLISH.md, one-time setup):
// mavenCentralUsername, mavenCentralPassword, signingInMemoryKey, signingInMemoryKeyId,
// signingInMemoryKeyPassword.
mavenPublishing {
    // The plugin builds the sources jar and an empty javadoc jar (Central requires one;
    // Dokka is not worth a dependency for KDoc that the sources jar already carries).
    configure(KotlinJvm(javadocJar = JavadocJar.Empty(), sourcesJar = true))
    publishToMavenCentral()
    if (project.hasProperty("signingInMemoryKey")) signAllPublications()
    coordinates(group.toString(), "i18n-keyless-kotlin", version.toString())
    pom {
        name.set("i18n-keyless-kotlin")
        description.set("Keyless i18n for Kotlin and Android: the source string is the translation key, AI translations at runtime, 48 languages.")
        url.set("https://i18n-keyless.com")
        licenses {
            license {
                name.set("MIT")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("arnaudambro")
                name.set("Arnaud Ambroselli")
                email.set("arnaud.ambroselli.io@gmail.com")
            }
        }
        scm {
            url.set("https://github.com/arnaudambro/i18n-keyless")
            connection.set("scm:git:https://github.com/arnaudambro/i18n-keyless.git")
            developerConnection.set("scm:git:git@github.com:arnaudambro/i18n-keyless.git")
        }
    }
}
