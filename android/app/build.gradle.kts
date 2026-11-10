plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.whatsgramy.app"
    compileSdk = 35
    defaultConfig { applicationId = "com.whatsgramy.app"; minSdk = 26; targetSdk = 35; versionCode = 3; versionName = "0.3.0"; ndk { abiFilters += listOf("arm64-v8a", "x86_64") }; externalNativeBuild { cmake { cppFlags += "-std=c++17" } } }
    buildFeatures { buildConfig = true }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
    packaging { jniLibs { useLegacyPackaging = false } }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
