package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/Jhut89/stoop/internal/app"
	"github.com/Jhut89/stoop/internal/buildinfo"
	"github.com/Jhut89/stoop/internal/config"
)

func main() {
	// Subcommands run and exit; the bare binary serves.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "admin":
			os.Exit(runAdmin(context.Background(), os.Args[2:], os.Stdout))
		case "version", "--version", "-v":
			fmt.Println("stoop", buildinfo.String())
			return
		}
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)
	log.Info("starting stoop", "version", buildinfo.String())

	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a, err := app.New(ctx, cfg, log)
	if err != nil {
		log.Error("startup failed", "err", err)
		os.Exit(1)
	}
	if err := a.Run(ctx); err != nil {
		log.Error("server error", "err", err)
		os.Exit(1)
	}
}
