; Ganchos do instalador NSIS do app em Tauri (ADR-0062).
;
; Migração do app Electron: o atualizador do Electron (ADR-0051) baixa este instalador como uma versão nova e o
; executa com "/S --updated" (ao fechar) ou "/S --updated --force-run" (sozinho, ocioso) ou "--updated --force-run"
; ("Reiniciar e atualizar agora"). Antes de instalar, o app Electron é fechado e desinstalado em silêncio (os dados
; dele em %APPDATA%\@opencord\desktop ficam: o app novo importa a sessão na primeira abertura, migrate.rs). Os atalhos
; "OpenCord" do Electron saem antes de o instalador criar os novos.

!include "FileFunc.nsh"

; Atualização pelo app ("Reiniciar e atualizar agora", updater.rs): modo passivo do Tauri ("/P"), que pula as telas
; e fecha sozinho no fim. A janela vira só progresso: sem botões, sem "Mostrar detalhes" e sem o X da barra de
; título (WS_SYSMENU); dá para mover, e mais nada.
!macro OPENCORD_PROGRESS_ONLY
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "/P" $R7
  IfErrors opencord_not_passive
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Atualizando o OpenCord"
    !insertmacro MUI_HEADER_TEXT "Atualizando o OpenCord" "Aguarde: o app abre de novo sozinho quando terminar."
    ; 1 = Próximo, 2 = Cancelar, 3 = Voltar
    GetDlgItem $R7 $HWNDPARENT 1
    ShowWindow $R7 ${SW_HIDE}
    GetDlgItem $R7 $HWNDPARENT 2
    ShowWindow $R7 ${SW_HIDE}
    GetDlgItem $R7 $HWNDPARENT 3
    ShowWindow $R7 ${SW_HIDE}
    ; "Mostrar detalhes" fica na página interna
    FindWindow $R8 "#32770" "" $HWNDPARENT
    GetDlgItem $R7 $R8 1027
    ShowWindow $R7 ${SW_HIDE}
    ; sem o menu da janela não há X, minimizar nem ícone; a barra de título continua arrastável
    System::Call "user32::GetWindowLong(p $HWNDPARENT, i -16) i .R7"
    IntOp $R7 $R7 & 0xFFF7FFFF
    System::Call "user32::SetWindowLong(p $HWNDPARENT, i -16, i R7)"
    ; SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED: redesenha a moldura
    System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i 0, i 0, i 0, i 0, i 0x37)"
  opencord_not_passive:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OPENCORD_PROGRESS_ONLY
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
