package git

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// MinVersion is the oldest supported git (worktree -z, --path-format etc.).
var MinVersion = [2]int{2, 30}

var reGitVersion = regexp.MustCompile(`git version (\d+)\.(\d+)`)

// Preflight verifies git is installed and recent enough.
func Preflight(ctx context.Context) error {
	if _, err := exec.LookPath("git"); err != nil {
		return errors.New("git was not found on PATH; install git 2.30 or newer")
	}
	out, err := Runner{}.Run(ctx, "--version")
	if err != nil {
		return fmt.Errorf("git --version failed: %w", err)
	}
	major, minor, ok := parseGitVersion(string(out))
	if !ok {
		return nil // unusual build string; let it try
	}
	if major < MinVersion[0] || (major == MinVersion[0] && minor < MinVersion[1]) {
		return fmt.Errorf("git %d.%d is too old; void needs %d.%d or newer", major, minor, MinVersion[0], MinVersion[1])
	}
	return nil
}

func parseGitVersion(s string) (major, minor int, ok bool) {
	m := reGitVersion.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0, 0, false
	}
	major, _ = strconv.Atoi(m[1])
	minor, _ = strconv.Atoi(m[2])
	return major, minor, true
}
