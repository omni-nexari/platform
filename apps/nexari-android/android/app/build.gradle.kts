plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.chiho.nexari"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.chiho.nexari"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // Allow http://192.168.x.x dev API base over plain HTTP.
        manifestPlaceholders["usesCleartextTraffic"] = "true"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        getByName("debug") {
            isMinifyEnabled = false
        }
    }

    flavorDimensions += "channel"
    productFlavors {
        // Dev build — points at local dev server on 192.168.1.17:3000.
        create("dev") {
            dimension = "channel"
            buildConfigField("boolean", "OTA_ENABLED", "false")
            buildConfigField("String",  "DEFAULT_API_BASE", "\"http://192.168.1.17:3000/api/v1\"")
            buildConfigField("String",  "DEFAULT_WS_BASE",  "\"ws://192.168.1.17:3000\"")
            buildConfigField("String",  "DEFAULT_OTA_URL",  "\"\"")
        }
        // Self-hosted APK with in-app OTA enabled.
        create("self") {
            dimension = "channel"
            buildConfigField("boolean", "OTA_ENABLED", "true")
            buildConfigField("String",  "DEFAULT_API_BASE", "\"https://ds.chiho.app/api/v1\"")
            buildConfigField("String",  "DEFAULT_WS_BASE",  "\"wss://ds.chiho.app\"")
            buildConfigField("String",  "DEFAULT_OTA_URL",  "\"https://ds.chiho.app/android/update.json\"")
        }
        // Google Play / Managed Play — Play handles updates.
        create("play") {
            dimension = "channel"
            buildConfigField("boolean", "OTA_ENABLED", "false")
            buildConfigField("String",  "DEFAULT_API_BASE", "\"https://ds.chiho.app/api/v1\"")
            buildConfigField("String",  "DEFAULT_WS_BASE",  "\"wss://ds.chiho.app\"")
            buildConfigField("String",  "DEFAULT_OTA_URL",  "\"\"")
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.2")
    implementation("androidx.lifecycle:lifecycle-process:2.8.2")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.google.code.gson:gson:2.11.0")
}
