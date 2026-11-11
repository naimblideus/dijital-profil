# Plan aklının zamanlanmış görevini kurar. Bir kez çalıştırılır:  pwsh -File hat\plan-akil-gorev-kur.ps1
# Durdurmak:  Disable-ScheduledTask -TaskName 'Nextus Plan Akli'
# Oturum açılınca başlar ve sürekli çalışır; düşerse 5 dakikada bir yeniden başlatılır. Sıra boşken Claude çalışmaz.
$ErrorActionPreference = 'Stop'
$kok = Split-Path -Parent $PSScriptRoot
$pwsh = (Get-Command pwsh).Source
$node = (Get-Command node).Source
$komut = "& '$node' '$kok\hat\plan-akil.mjs'"
$eylem = New-ScheduledTaskAction -Execute $pwsh -WorkingDirectory $kok -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$komut`""
$sik = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$giris = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$giris.Delay = 'PT2M'
$ayar = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Nextus Plan Akli' -Action $eylem -Trigger @($sik, $giris) -Settings $ayar -Description 'Kafama at sırası: sesle eklenen işleri Claude ile sınıflandırır.' -Force | Out-Null
Write-Host 'Kuruldu: Nextus Plan Akli'
