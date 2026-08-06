# Makefile — svc-forum 架构体检入口
.PHONY: health-check

health-check: ## 运行架构体检（输出 JSON + exit code）
	@cd svc-forum && npx tsc --noEmit 2>/dev/null; \
	bash ../scripts/arch-health-check.sh
