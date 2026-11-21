plugins {
    kotlin("multiplatform")
    kotlin("plugin.compose")
    id("org.jetbrains.compose")
    id("com.android.application")
}

kotlin {
    jvmToolchain(17)
    androidTarget()
    jvm("desktop")
    applyDefaultHierarchyTemplate()

    sourceSets {
        commonMain.dependencies {
            implementation(project(":shared"))
            implementation("org.jetbrains.compose.foundation:foundation:1.10.3")
            implementation("org.jetbrains.compose.material3:material3:1.9.0")
            implementation("org.jetbrains.compose.components:components-resources:1.10.3")
        }
        val jvmImagesMain by creating {
            dependsOn(commonMain.get())
            dependencies { implementation("com.google.zxing:core:3.5.4") }
        }
        androidMain {
            dependsOn(jvmImagesMain)
            dependencies { implementation("androidx.activity:activity-compose:1.10.1") }
        }
        val desktopMain by getting {
            dependsOn(jvmImagesMain)
            dependencies {
                implementation(compose.desktop.currentOs)
            }
        }
    }
}

android {
    namespace = "ch.doppel.pocket"
    compileSdk = 36
    defaultConfig {
        applicationId = "ch.doppel.pocket"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

compose.desktop {
    application {
        mainClass = "ch.doppel.pocket.MainKt"
    }
}

compose.resources {
    packageOfResClass = "ch.doppel.pocket.resources"
}
