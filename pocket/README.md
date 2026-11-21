# Doppel Pocket

Doppel Pocket runs the Doppel financial twin on Android and the desktop JVM. Both apps use the same seeded simulation, Swiss affordability rules, what-if parser and goal solver. Lukas and Elena are fictional demo profiles.

## Build and run

Open the `pocket/` directory as its own Gradle project in IntelliJ IDEA or Android Studio. Set the Gradle JVM to JDK 17. This project was built with Temurin 17.0.16+8, Gradle 8.13, Kotlin 2.3.21, Compose Multiplatform 1.10.3, Material 3 1.9.0 and Android Gradle Plugin 8.13.2. Gradle 8.13 predates Java 25 runtime support.

From this directory on Windows:

```powershell
# Set JAVA_HOME to the installed JDK 17 directory before running the wrapper.
.\gradlew.bat :composeApp:run
.\gradlew.bat :shared:jvmTest :composeApp:assembleDebug
```

Use `./gradlew` on macOS and Linux. `:composeApp:run` opens the desktop window.

For Android, install SDK Platform 36 and Build Tools 35.0.0. Set `ANDROID_HOME` or create an ignored `local.properties` in `pocket/` with `sdk.dir=C:/Users/you/AppData/Local/Android/Sdk`. The app targets API 36 and requires API 24 or newer.

Install the debug APK on a running emulator or USB-connected device:

```powershell
adb install -r composeApp/build/outputs/apk/debug/composeApp-debug.apk
adb shell am start -n ch.doppel.pocket/.MainActivity
```

Use the profile picker to switch demo profiles. In **What-if**, choose an example or enter a command, then select **Simulate**. **Find my path** evaluates recipes on the same 1,000 seeded paths used for the headline. Applying a recipe updates the overview. The settings menu contains English, German, French, Turkish, and the system, light and dark appearance options.

**Import QR bill** opens the Android photo picker or desktop file chooser. Select a PNG or JPEG containing a Swiss QR bill. The review dialog shows the effect before you add it to the plan. A one-off bill becomes an expense in the first simulated month. Recurring bills change the monthly budget and are checked against recurring costs already in the plan and demo history. Scenario edits are held in the app session.

## Engine parity

From the repository root, run these commands to regenerate the checked-in fixtures and resource XML. The Turkish generator uses Pocket's translated fallback where the current web dictionary inherits English. A Turkish translation in the web dictionary takes precedence.

```powershell
npx tsx scripts/pocket-engine-golden.ts
npx tsx pocket/generate-strings.ts
npx tsx pocket/generate-strings.ts --check
```

`:shared:jvmTest` compares 2,679 numeric values with TypeScript across five scenarios. It checks exact goal probabilities, exact draws for four PRNG seeds, the retirement and affordability results, the full percentile cones, and recipe effects. The maximum absolute difference was `7.450580596923828e-9` CHF in Elena's ideal P90 cone. Lukas's base goal probabilities are 69.6% ideal and 40.3% real. Applying the first solver recipe gives 81.1% real.

## Source sets

Physical Kotlin source lines, including comments and blank lines. Tests and generated build files are excluded.

| Source set | Shared engine | Compose app | Role |
| --- | ---: | ---: | --- |
| `commonMain` | 1,973 | 724 | Engine, profiles, four intent parsers, QR payload and expense rules, Material 3 screens, chart and resources integration |
| `androidMain` | 11 | 99 | System date and Unicode bridge, activity, system bars, locale and photo picker |
| `desktopMain` | 0 | 89 | Window, locale and file chooser |
| `jvmMain` | 11 | 0 | Desktop engine date and Unicode bridge |
| `jvmImagesMain` | 0 | 19 | ZXing decoder used by Android and desktop |
| Server | 0 | 0 | Optional module omitted |

The four Compose XML string bundles total 420 lines. To reproduce the counts, run from the repository root:

```powershell
function Count-Lines($path, $extension) {
    if (!(Test-Path $path)) { return 0 }
    $total = 0
    foreach ($file in (Get-ChildItem $path -Recurse -File -Filter "*.$extension")) {
        $total += [IO.File]::ReadAllLines($file.FullName).Length
    }
    $total
}
foreach ($set in 'commonMain','androidMain','desktopMain','jvmMain','jvmImagesMain') {
    "$set shared=$(Count-Lines "pocket/shared/src/$set" kt) composeApp=$(Count-Lines "pocket/composeApp/src/$set" kt)"
}
Count-Lines 'pocket/composeApp/src/commonMain/composeResources' xml
Count-Lines 'pocket/server/src' kt
```
