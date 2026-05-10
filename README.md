# SILENCE

SILENCE is a greenfield encrypted payroll system for Solana + Arcium. The v1 implementation keeps employee wallet addresses public while salary, bonus, deduction, adjustment, and net-pay amounts flow through encrypted payroll batches.

## Workspace

- `apps/web` - Next.js HR/payroll dashboard.
- `packages/shared` - shared payroll and HR types.
- `packages/sdk` - TypeScript SDK facade for encrypted batches, run lifecycle, and report export.
- `programs/silence` - Anchor-style Solana program and Arcium circuit integration stubs.

## Current V1 Behavior

- Organization setup and single-admin payroll operations.
- Employee registry with metadata hashes and encrypted compensation references.
- Program-vault USDC custody model represented in protocol state.
- Payroll batches encrypted client-side before submission.
- Arcium computation lifecycle modeled as queued -> computing -> validated -> paid.
- Export-ready reporting without tax filing or jurisdiction-specific tax calculation.

## Devnet

The current program is deployed on Solana devnet:

- Program id: `FdBmwEbm8MbJZnuFEEvtdbZDGh4vrthsLhFaZ6eFmGsb`
- Arcium devnet cluster offset: `456`
- MXE status: active

Useful commands:

```powershell
cargo test
npm run typecheck
npm run build
wsl.exe bash -lc "cd /mnt/c/Users/phant/OneDrive/Desktop/HUSH && arcium build"
wsl.exe bash -lc "cd /mnt/c/Users/phant/OneDrive/Desktop/HUSH && arcium test --cluster devnet --offset 456 --skip-build"
```

Redeploy/update devnet after program changes:

```powershell
wsl.exe bash -lc "cd /mnt/c/Users/phant/OneDrive/Desktop/HUSH && arcium deploy --cluster-offset 456 --recovery-set-size 4 --keypair-path ~/.config/solana/id.json --program-keypair target/deploy/silence-keypair.json --program-name silence --rpc-url devnet --resume"
```

## Next Steps For Live Chain Integration

1. Replace SDK transaction descriptors with generated Anchor client calls.
2. Wire callback finalization to Arcium's `awaitComputationFinalization`.
3. Add SPL Token integration tests using devnet/testnet USDC.
