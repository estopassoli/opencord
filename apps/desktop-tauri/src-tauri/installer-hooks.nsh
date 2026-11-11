; Ganchos do instalador NSIS do app em Tauri (ADR-0062).
;
; Migração do app Electron: o atualizador do Electron (ADR-0051) baixa este instalador como uma versão nova e o
; executa com "/S --updated" (ao fechar) ou "/S --updated --force-run" (sozinho, ocioso) ou "--updated --force-run"
; ("Reiniciar e atualizar agora"). Antes de instalar, o app Electron é fechado e desinstalado em silêncio (os dados
; dele em %APPDATA%\@opencord\desktop ficam: o app novo importa a sessão na primeira abertura, migrate.rs). Os atalhos
; "OpenCord" do Electron saem antes de o instalador criar os novos.

!include "FileFunc.nsh"

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM "OpenCord.exe"'
  Pop $0
  StrCpy $R9 "$LOCALAPPDATA\Programs\@opencorddesktop"
  IfFileExists "$R9\Uninstall OpenCord.exe" 0 opencord_no_electron
    ; _?= roda o desinstalador no lugar e espera ele terminar (sem se copiar para a pasta temporária)
    ExecWait '"$R9\Uninstall OpenCord.exe" /S _?=$R9'
    RMDir /r "$R9"
  opencord_no_electron:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; "--force-run": o app abre de novo depois da atualização (como o instalador do Electron fazia)
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--force-run" $R1
  IfErrors opencord_no_run
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  opencord_no_run:
!macroend
