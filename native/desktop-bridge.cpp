#define UNICODE
#define _UNICODE
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>

static std::vector<MONITORINFOEXW> monitors;
static BOOL CALLBACK findMonitor(HMONITOR monitor, HDC, LPRECT, LPARAM) {
  MONITORINFOEXW info{}; info.cbSize = sizeof(info); GetMonitorInfoW(monitor, &info); monitors.push_back(info); return TRUE;
}
static void boundsJSON(HWND window) {
  RECT rectangle{}; GetWindowRect(window, &rectangle);
  std::cout << "\"boundsPixels\":{\"x\":" << rectangle.left << ",\"y\":" << rectangle.top << ",\"width\":" << rectangle.right-rectangle.left << ",\"height\":" << rectangle.bottom-rectangle.top << "},\"dpi\":" << GetDpiForWindow(window);
}

static HWND host = nullptr;
static BOOL CALLBACK findHost(HWND window, LPARAM) {
  HWND icons = FindWindowExW(window, nullptr, L"SHELLDLL_DefView", nullptr);
  if (icons) {
    // A passive wallpaper WorkerW cannot receive clicks behind the icon view.
    // Use a bounded sibling above SHELLDLL_DefView instead; leave icons outside.
    host = window;
    return FALSE;
  }
  return TRUE;
}
static void error(const char* message) {
  std::cout << "{\"attached\":false,\"reason\":\"" << message << "\",\"win32Error\":" << GetLastError() << "}" << std::endl;
}
int wmain(int argc, wchar_t** argv) {
  SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  if (argc < 3) { error("Missing arguments"); return 1; }
  std::wstring command = argv[1];
  if (command == L"secure-pipe") {
    HANDLE token = nullptr; OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token);
    DWORD length = 0; GetTokenInformation(token, TokenUser, nullptr, 0, &length);
    auto user = reinterpret_cast<TOKEN_USER*>(LocalAlloc(LPTR, length));
    if (!token || !GetTokenInformation(token, TokenUser, user, length, &length)) { error("Cannot obtain user SID"); return 1; }
    LPWSTR sid = nullptr; ConvertSidToStringSidW(user->User.Sid, &sid);
    // Deny network logons, allow only this user. Protect from inherited ACLs.
    std::wstring sddl = L"D:P(D;;GA;;;NU)(A;;GA;;;" + std::wstring(sid) + L")";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) { error("Cannot create pipe ACL"); return 1; }
    BOOL present, defaulted; PACL acl = nullptr; GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted);
    HANDLE pipe = CreateFileW(argv[2], WRITE_DAC, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    DWORD result = pipe == INVALID_HANDLE_VALUE ? GetLastError() : SetSecurityInfo(pipe, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, nullptr, nullptr, acl, nullptr);
    if (pipe != INVALID_HANDLE_VALUE) CloseHandle(pipe);
    LocalFree(descriptor); LocalFree(sid); LocalFree(user); CloseHandle(token);
    if (result != ERROR_SUCCESS) { SetLastError(result); error("Cannot restrict pipe to current user"); return 1; }
    std::cout << "{\"secured\":true}" << std::endl; return 0;
  }
  HWND window = reinterpret_cast<HWND>(std::stoull(argv[2]));
  if (!IsWindow(window)) { error("Window handle is no longer valid"); return 0; }
  if (command == L"position") {
    if (argc < 4) { error("Missing display number"); return 1; }
    EnumDisplayMonitors(nullptr, nullptr, findMonitor, 0);
    std::sort(monitors.begin(), monitors.end(), [](const auto& a, const auto& b) {
      bool ap = (a.dwFlags & MONITORINFOF_PRIMARY) != 0, bp = (b.dwFlags & MONITORINFOF_PRIMARY) != 0;
      if (ap != bp) return ap;
      return a.rcMonitor.left != b.rcMonitor.left ? a.rcMonitor.left < b.rcMonitor.left : a.rcMonitor.top < b.rcMonitor.top;
    });
    if (monitors.empty()) { error("No monitor available"); return 0; }
    int index = std::clamp(std::stoi(argv[3])-1, 0, static_cast<int>(monitors.size())-1);
    RECT area = monitors[index].rcWork;
    if (argc >= 8) {
      int width = std::min<int>(std::stoi(argv[6]), area.right-area.left), height = std::min<int>(std::stoi(argv[7]), area.bottom-area.top);
      area.left += std::clamp<int>(std::stoi(argv[4]),0,area.right-area.left-width);
      area.top += std::clamp<int>(std::stoi(argv[5]),0,area.bottom-area.top-height);
      area.right=area.left+width; area.bottom=area.top+height;
    }
    POINT point{area.left, area.top}; HWND parent = GetParent(window); if (parent) ScreenToClient(parent, &point);
    SetWindowPos(window, HWND_TOP, point.x, point.y, area.right-area.left, area.bottom-area.top, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    std::cout << "{\"attached\":" << (parent ? "true" : "false") << ",\"parent\":\"" << reinterpret_cast<UINT_PTR>(parent) << "\","; boundsJSON(window);
    std::cout << ",\"targetPixels\":{\"x\":" << area.left << ",\"y\":" << area.top << ",\"width\":" << area.right-area.left << ",\"height\":" << area.bottom-area.top << "}}" << std::endl;
    return 0;
  }
  if (command == L"status") {
    HWND parent = GetParent(window); wchar_t name[256]{};
    if (parent) GetClassNameW(parent, name, 256);
    bool attached = parent && (std::wstring(name) == L"WorkerW" || std::wstring(name) == L"Progman");
    std::cout << "{\"attached\":" << (attached ? "true" : "false") << ",\"parent\":\"" << reinterpret_cast<UINT_PTR>(parent) << "\","; boundsJSON(window); std::cout << "}" << std::endl; return 0;
  }
  if (command == L"detach") {
    SetParent(window, nullptr);
    LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    SetWindowLongPtrW(window, GWL_STYLE, (style & ~WS_CHILD) | WS_POPUP);
    SetWindowPos(window, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOACTIVATE);
    std::cout << "{\"attached\":false,\"reason\":\"Detached for diagnostic mode\"}" << std::endl; return 0;
  }
  if (command != L"attach") { error("Unknown native operation"); return 1; }
  HWND progman = FindWindowW(L"Progman", nullptr);
  if (!progman) { error("Explorer desktop unavailable"); return 0; }
  DWORD_PTR ignored; SendMessageTimeoutW(progman, 0x052C, 0xD, 0, SMTO_NORMAL, 1000, &ignored);
  SendMessageTimeoutW(progman, 0x052C, 0xD, 1, SMTO_NORMAL, 1000, &ignored);
  EnumWindows(findHost, 0);
  if (!host) { error("Desktop host not found"); return 0; }
  RECT bounds{}; GetWindowRect(window, &bounds); POINT point{bounds.left, bounds.top}; ScreenToClient(host, &point);
  LONG_PTR original = GetWindowLongPtrW(window, GWL_STYLE);
  SetWindowLongPtrW(window, GWL_STYLE, (original & ~WS_POPUP) | WS_CHILD);
  SetLastError(0); SetParent(window, host);
  if (GetParent(window) != host) { SetWindowLongPtrW(window, GWL_STYLE, original); error("SetParent failed"); return 0; }
  SetWindowPos(window, HWND_TOP, point.x, point.y, bounds.right-bounds.left, bounds.bottom-bounds.top, SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  std::cout << "{\"attached\":true,\"parent\":\"" << reinterpret_cast<UINT_PTR>(host) << "\",\"method\":\"Explorer desktop host\"}" << std::endl;
  return 0;
}
