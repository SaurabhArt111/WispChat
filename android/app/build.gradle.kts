plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Firebase push is optional: drop your google-services.json into android/app/ and rebuild to turn it on.
// Without that file the app still builds and runs (it then uses a quiet background connection instead).
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.wispchat.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.wispchat.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.3.0"
        val backend = (project.findProperty("WISP_BACKEND") as String? ?: "https://wispchat-bkjl.onrender.com").trimEnd('/')
        buildConfigField("String", "BACKEND_URL", "\"$backend\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.socket:socket.io-client:2.1.1") { exclude(group = "org.json", module = "json") }
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-gif:2.7.0")    // animated GIFs / stickers
    implementation("io.coil-kt:coil-video:2.7.0")  // video thumbnails in the camera's gallery strip
    // videos are re-encoded with the phone's hardware encoder before sending (720p H.264)
    val media3 = "1.5.1"
    implementation("androidx.media3:media3-transformer:$media3")
    implementation("androidx.media3:media3-effect:$media3")
    implementation("androidx.media3:media3-common:$media3")
    // faster first launch / scrolling: ships ahead-of-time compiled code profiles
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    // in-app camera (WhatsApp-style: photo / video, recents strip, swipe up for the gallery)
    val camerax = "1.4.1"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-video:$camerax")
    implementation("androidx.camera:camera-view:$camerax")
    implementation("io.getstream:stream-webrtc-android:1.3.7")
    // replays the offline action queue in the background once the phone is online again
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

composeCompiler {
    // immutable models → stable → Compose skips unchanged rows (see compose_stability.conf)
    stabilityConfigurationFile = project.layout.projectDirectory.file("compose_stability.conf")
}
