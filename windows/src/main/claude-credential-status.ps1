$source = @'
using System;
using System.Runtime.InteropServices;

public static class PulseCredentialReader {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public UInt32 Flags;
        public UInt32 Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, int flags, out IntPtr credential);

    [DllImport("Advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    public static bool Exists(string target) {
        IntPtr pointer;
        if (!CredRead(target, 1, 0, out pointer)) return false;
        CredFree(pointer);
        return true;
    }
}
'@

try {
    Add-Type -TypeDefinition $source -ErrorAction Stop
    $base = 'Claude Code-credentials/claude-code-user'
    $found = [PulseCredentialReader]::Exists($base) -or [PulseCredentialReader]::Exists("$base#m")
    if ($found) { Write-Output 'true'; exit 0 }
} catch {}
Write-Output 'false'
exit 1
