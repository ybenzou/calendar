#define UNICODE
#define _UNICODE
#include <windows.h>
#include <iostream>
#include <string>

int wmain() {
  wchar_t filename[32768]{}; GetModuleFileNameW(nullptr, filename, 32768);
  std::wstring directory(filename); directory = directory.substr(0, directory.find_last_of(L"\\/"));
  std::wstring executable = directory + L"\\Desktop Calendar.exe";
  std::wstring cli = directory + L"\\resources\\app.asar\\out\\cli\\index.cjs";
  // Preserve the original argument string (including quoted paths and Unicode).
  std::wstring original = GetCommandLineW(); size_t end = original[0] == L'"' ? original.find(L'"', 1) + 1 : original.find(L' ');
  std::wstring arguments = end == std::wstring::npos ? L"" : original.substr(end);
  std::wstring command = L"\"" + executable + L"\" \"" + cli + L"\"" + arguments;
  SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1"); SetEnvironmentVariableW(L"CALENDAR_PACKAGED", L"1");
  STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE); startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION child{};
  if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, directory.c_str(), &startup, &child)) {
    std::cerr << "Calendar CLI could not start: " << GetLastError() << std::endl; return 1;
  }
  WaitForSingleObject(child.hProcess, INFINITE); DWORD exitCode; GetExitCodeProcess(child.hProcess, &exitCode);
  CloseHandle(child.hThread); CloseHandle(child.hProcess); return static_cast<int>(exitCode);
}
