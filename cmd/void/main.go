// Command void serves a visual git changeset viewer for a repository.
//
//	void [flags] [path]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"void/internal/api"
	"void/internal/git"
	"void/web"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "void:", err)
		os.Exit(1)
	}
}

func run() error {
	fs := flag.NewFlagSet("void", flag.ContinueOnError)
	host := fs.String("host", "127.0.0.1", "interface to bind (use 0.0.0.0 inside a dev container)")
	port := fs.Int("port", 0, "port to listen on (0 picks a free port)")
	open := fs.Bool("open", false, "open the UI in the default browser")
	showVersion := fs.Bool("version", false, "print version and exit")
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "usage: void [flags] [path]\n\nServe a visual changeset viewer for the git repository at path (default \".\").\n\n")
		fs.PrintDefaults()
	}
	if err := fs.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if *showVersion {
		fmt.Println("void", version)
		return nil
	}
	path := "."
	if fs.NArg() > 0 {
		path = fs.Arg(0)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	repo, err := git.Open(ctx, path)
	if err != nil {
		if errors.Is(err, git.ErrNotRepo) {
			return fmt.Errorf("%s is not inside a git repository", path)
		}
		return err
	}

	ln, err := net.Listen("tcp", net.JoinHostPort(*host, strconv.Itoa(*port)))
	if err != nil {
		return err
	}
	url := displayURL(*host, ln.Addr().(*net.TCPAddr).Port)
	fmt.Printf("void %s\n  repo: %s\n  url:  %s\n", version, repo.Root, url)

	srv := &http.Server{
		Handler:           api.New(repo, web.Dist(), version),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	if *open {
		openBrowser(url)
	}

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

// displayURL returns a URL a browser can actually open: wildcard binds are
// shown as localhost.
func displayURL(host string, port int) string {
	switch host {
	case "0.0.0.0", "::", "":
		host = "localhost"
	}
	return fmt.Sprintf("http://%s", net.JoinHostPort(host, strconv.Itoa(port)))
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		log.Printf("--open not supported on %s; visit %s", runtime.GOOS, url)
		return
	}
	if err := cmd.Start(); err != nil {
		log.Printf("open browser: %v", err)
	}
}
