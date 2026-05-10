use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

pub mod payroll_circuits;

const COMP_DEF_OFFSET_PREPARE_PAYROLL_RUN: u32 = comp_def_offset("prepare_payroll_run");
const COMP_DEF_OFFSET_VALIDATE_PAYROLL_RUN: u32 = comp_def_offset("validate_payroll_run");
const COMP_DEF_OFFSET_SEAL_EMPLOYEE_PAYSTUB: u32 = comp_def_offset("seal_employee_paystub");

declare_id!("FdBmwEbm8MbJZnuFEEvtdbZDGh4vrthsLhFaZ6eFmGsb");

#[arcium_program]
pub mod silence {
    use super::*;

    pub fn init_prepare_payroll_run_comp_def(ctx: Context<InitPreparePayrollRunCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_validate_payroll_run_comp_def(ctx: Context<InitValidatePayrollRunCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_seal_employee_paystub_comp_def(ctx: Context<InitSealEmployeePaystubCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn initialize_organization(
        ctx: Context<InitializeOrganization>,
        name: String,
        bump: u8,
    ) -> Result<()> {
        require!(name.len() <= Organization::MAX_NAME_LEN, ErrorCode::NameTooLong);

        let organization = &mut ctx.accounts.organization;
        organization.admin = ctx.accounts.admin.key();
        organization.usdc_mint = ctx.accounts.usdc_mint.key();
        organization.vault = ctx.accounts.vault.key();
        organization.name = name;
        organization.bump = bump;
        organization.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn add_employee(
        ctx: Context<AddEmployee>,
        metadata_hash: [u8; 32],
        department_hash: [u8; 32],
        role_hash: [u8; 32],
        encrypted_compensation_ref: EncryptedRef,
    ) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;

        let employee = &mut ctx.accounts.employee;
        employee.organization = ctx.accounts.organization.key();
        employee.wallet = ctx.accounts.employee_wallet.key();
        employee.status = EmployeeStatus::Active;
        employee.metadata_hash = metadata_hash;
        employee.department_hash = department_hash;
        employee.role_hash = role_hash;
        employee.encrypted_compensation_ref = encrypted_compensation_ref;
        employee.created_at = Clock::get()?.unix_timestamp;
        employee.updated_at = employee.created_at;

        Ok(())
    }

    pub fn update_employee_status(ctx: Context<UpdateEmployeeStatus>, status: EmployeeStatus) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        let employee = &mut ctx.accounts.employee;
        employee.status = status;
        employee.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn deposit_vault(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        let transfer = Transfer {
            from: ctx.accounts.admin_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer), amount)?;
        Ok(())
    }

    pub fn create_payroll_run(
        ctx: Context<CreatePayrollRun>,
        period_start: i64,
        period_end: i64,
        batch_hash: [u8; 32],
        employee_count: u32,
    ) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        require!(period_start < period_end, ErrorCode::InvalidPayPeriod);
        require!(employee_count > 0, ErrorCode::EmptyPayrollRun);

        let run = &mut ctx.accounts.payroll_run;
        run.organization = ctx.accounts.organization.key();
        run.period_start = period_start;
        run.period_end = period_end;
        run.batch_hash = batch_hash;
        run.employee_count = employee_count;
        run.status = PayrollRunStatus::Draft;
        run.encrypted_prepared_payroll = None;
        run.encrypted_validation_result = None;
        run.encrypted_aggregate_net_pay = None;
        run.prepare_computation_account = Pubkey::default();
        run.validate_computation_account = Pubkey::default();
        run.seal_computation_account = Pubkey::default();
        run.computation_account = Pubkey::default();
        run.callback_signature = None;
        run.created_at = Clock::get()?.unix_timestamp;
        run.updated_at = run.created_at;

        Ok(())
    }

    pub fn queue_payroll_computation(
        ctx: Context<QueuePayrollComputation>,
        computation_offset: u64,
        encrypted_batch_hash: [u8; 32],
        encrypted_gross_pay: [u8; 32],
        encrypted_bonus: [u8; 32],
        encrypted_deductions: [u8; 32],
        encrypted_adjustments: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        transition(&ctx.accounts.payroll_run.status, PayrollRunStatus::Preparing)?;

        let run = &mut ctx.accounts.payroll_run;
        require_keys_eq!(run.organization, ctx.accounts.organization.key(), ErrorCode::InvalidOrganization);
        require!(run.batch_hash == encrypted_batch_hash, ErrorCode::BatchHashMismatch);

        run.status = PayrollRunStatus::Preparing;
        run.prepare_computation_account = ctx.accounts.computation_account.key();
        run.computation_account = ctx.accounts.computation_account.key();
        run.updated_at = Clock::get()?.unix_timestamp;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_gross_pay)
            .encrypted_u64(encrypted_bonus)
            .encrypted_u64(encrypted_deductions)
            .encrypted_u64(encrypted_adjustments)
            .build();

        let callback_accounts = [CallbackAccount {
            pubkey: ctx.accounts.payroll_run.key(),
            is_writable: true,
        }];
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![PreparePayrollRunCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "prepare_payroll_run")]
    pub fn prepare_payroll_run_callback(
        ctx: Context<PreparePayrollRunCallback>,
        output: SignedComputationOutputs<PreparePayrollRunOutput>,
    ) -> Result<()> {
        let prepared = match output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account) {
            Ok(PreparePayrollRunOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let run = &mut ctx.accounts.payroll_run;
        require!(
            matches!(run.status, PayrollRunStatus::Preparing),
            ErrorCode::InvalidStatusTransition
        );

        run.status = PayrollRunStatus::Prepared;
        run.encrypted_prepared_payroll = Some(SharedEncryptedTwo {
            owner: EncryptionOwner::Shared,
            encryption_key: prepared.encryption_key,
            nonce: prepared.nonce,
            ciphertext_hashes: prepared.ciphertexts,
        });
        run.encrypted_aggregate_net_pay = Some(EncryptedRef {
            owner: EncryptionOwner::Shared,
            nonce: prepared.nonce.to_le_bytes(),
            ciphertext_hash: prepared.ciphertexts[0],
        });
        run.callback_signature = None;

        run.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn queue_validate_payroll_run(
        ctx: Context<QueueValidatePayrollRun>,
        computation_offset: u64,
        vault_balance_pubkey: [u8; 32],
        vault_balance_nonce: u128,
        encrypted_vault_balance: [u8; 32],
    ) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        transition(&ctx.accounts.payroll_run.status, PayrollRunStatus::Validating)?;

        let run = &mut ctx.accounts.payroll_run;
        require_keys_eq!(run.organization, ctx.accounts.organization.key(), ErrorCode::InvalidOrganization);
        let prepared = run.encrypted_prepared_payroll.ok_or(ErrorCode::MissingPreparedPayroll)?;

        run.status = PayrollRunStatus::Validating;
        run.validate_computation_account = ctx.accounts.computation_account.key();
        run.computation_account = ctx.accounts.computation_account.key();
        run.updated_at = Clock::get()?.unix_timestamp;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(prepared.encryption_key)
            .plaintext_u128(prepared.nonce)
            .encrypted_u64(prepared.ciphertext_hashes[0])
            .encrypted_bool(prepared.ciphertext_hashes[1])
            .x25519_pubkey(vault_balance_pubkey)
            .plaintext_u128(vault_balance_nonce)
            .encrypted_u64(encrypted_vault_balance)
            .plaintext_u32(run.employee_count)
            .build();

        let callback_accounts = [CallbackAccount {
            pubkey: ctx.accounts.payroll_run.key(),
            is_writable: true,
        }];
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![ValidatePayrollRunCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "validate_payroll_run")]
    pub fn validate_payroll_run_callback(
        ctx: Context<ValidatePayrollRunCallback>,
        output: SignedComputationOutputs<ValidatePayrollRunOutput>,
    ) -> Result<()> {
        let validation = match output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account) {
            Ok(ValidatePayrollRunOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let run = &mut ctx.accounts.payroll_run;
        require!(run.status == PayrollRunStatus::Validating, ErrorCode::InvalidStatusTransition);

        run.status = PayrollRunStatus::Validated;
        run.encrypted_validation_result = Some(SharedEncryptedThree {
            owner: EncryptionOwner::Shared,
            encryption_key: validation.encryption_key,
            nonce: validation.nonce,
            ciphertext_hashes: validation.ciphertexts,
        });
        run.callback_signature = None;
        run.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn create_payroll_payout(ctx: Context<CreatePayrollPayout>) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        require!(ctx.accounts.payroll_run.status == PayrollRunStatus::Validated, ErrorCode::PayrollNotValidated);
        require_keys_eq!(ctx.accounts.employee.organization, ctx.accounts.organization.key(), ErrorCode::InvalidOrganization);

        let payout = &mut ctx.accounts.payout;
        payout.payroll_run = ctx.accounts.payroll_run.key();
        payout.employee = ctx.accounts.employee.key();
        payout.employee_wallet = ctx.accounts.employee.wallet;
        payout.encrypted_net_pay = None;
        payout.status = PayoutStatus::Pending;
        payout.signature = None;
        payout.created_at = Clock::get()?.unix_timestamp;
        payout.updated_at = payout.created_at;
        Ok(())
    }

    pub fn queue_seal_employee_paystub(
        ctx: Context<QueueSealEmployeePaystub>,
        computation_offset: u64,
    ) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        require!(ctx.accounts.payroll_run.status == PayrollRunStatus::Validated, ErrorCode::PayrollNotValidated);
        require_keys_eq!(ctx.accounts.payout.payroll_run, ctx.accounts.payroll_run.key(), ErrorCode::InvalidPayout);

        let run = &mut ctx.accounts.payroll_run;
        let prepared = run.encrypted_prepared_payroll.ok_or(ErrorCode::MissingPreparedPayroll)?;

        run.status = PayrollRunStatus::SealingPaystubs;
        run.seal_computation_account = ctx.accounts.computation_account.key();
        run.computation_account = ctx.accounts.computation_account.key();
        run.updated_at = Clock::get()?.unix_timestamp;

        ctx.accounts.payout.status = PayoutStatus::Sealing;
        ctx.accounts.payout.updated_at = Clock::get()?.unix_timestamp;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(prepared.encryption_key)
            .plaintext_u128(prepared.nonce)
            .encrypted_u64(prepared.ciphertext_hashes[0])
            .encrypted_bool(prepared.ciphertext_hashes[1])
            .build();

        let callback_accounts = [
            CallbackAccount {
                pubkey: ctx.accounts.payroll_run.key(),
                is_writable: true,
            },
            CallbackAccount {
                pubkey: ctx.accounts.payout.key(),
                is_writable: true,
            },
        ];
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![SealEmployeePaystubCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "seal_employee_paystub")]
    pub fn seal_employee_paystub_callback(
        ctx: Context<SealEmployeePaystubCallback>,
        output: SignedComputationOutputs<SealEmployeePaystubOutput>,
    ) -> Result<()> {
        let sealed = match output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account) {
            Ok(SealEmployeePaystubOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let payout = &mut ctx.accounts.payout;
        require!(payout.status == PayoutStatus::Sealing, ErrorCode::InvalidPayout);
        payout.encrypted_net_pay = Some(SharedEncryptedTwo {
            owner: EncryptionOwner::Shared,
            encryption_key: sealed.encryption_key,
            nonce: sealed.nonce,
            ciphertext_hashes: sealed.ciphertexts,
        });
        payout.status = PayoutStatus::Ready;
        payout.updated_at = Clock::get()?.unix_timestamp;

        let run = &mut ctx.accounts.payroll_run;
        require!(run.status == PayrollRunStatus::SealingPaystubs, ErrorCode::InvalidStatusTransition);
        run.status = PayrollRunStatus::ReadyToPay;
        run.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn execute_payroll(ctx: Context<ExecutePayroll>) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        require!(ctx.accounts.payroll_run.status == PayrollRunStatus::ReadyToPay, ErrorCode::PayrollNotReady);

        let run = &mut ctx.accounts.payroll_run;
        run.status = PayrollRunStatus::Paid;
        run.updated_at = Clock::get()?.unix_timestamp;

        // SPL token transfers are executed per payout account in the production instruction.
        // This scaffold keeps transfer fan-out out of the single-account v1 shell.
        Ok(())
    }

    pub fn cancel_payroll_run(ctx: Context<CancelPayrollRun>) -> Result<()> {
        require_admin(&ctx.accounts.organization, &ctx.accounts.admin)?;
        let status = ctx.accounts.payroll_run.status;
        require!(
            matches!(
                status,
                PayrollRunStatus::Draft
                    | PayrollRunStatus::Preparing
                    | PayrollRunStatus::Prepared
                    | PayrollRunStatus::Validating
                    | PayrollRunStatus::Validated
                    | PayrollRunStatus::SealingPaystubs
                    | PayrollRunStatus::ReadyToPay
            ),
            ErrorCode::InvalidStatusTransition
        );

        let run = &mut ctx.accounts.payroll_run;
        run.status = PayrollRunStatus::Cancelled;
        run.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[init_computation_definition_accounts("prepare_payroll_run", payer)]
#[derive(Accounts)]
pub struct InitPreparePayrollRunCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: initialized and checked by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("validate_payroll_run", payer)]
#[derive(Accounts)]
pub struct InitValidatePayrollRunCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: initialized and checked by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("seal_employee_paystub", payer)]
#[derive(Accounts)]
pub struct InitSealEmployeePaystubCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: initialized and checked by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, bump: u8)]
pub struct InitializeOrganization<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [b"organization", admin.key().as_ref()],
        bump,
        space = 8 + Organization::INIT_SPACE
    )]
    pub organization: Account<'info, Organization>,
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = organization,
        seeds = [b"vault", organization.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddEmployee<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub employee_wallet: SystemAccount<'info>,
    pub organization: Account<'info, Organization>,
    #[account(
        init,
        payer = admin,
        seeds = [b"employee", organization.key().as_ref(), employee_wallet.key().as_ref()],
        bump,
        space = 8 + Employee::INIT_SPACE
    )]
    pub employee: Account<'info, Employee>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEmployeeStatus<'info> {
    pub admin: Signer<'info>,
    pub organization: Account<'info, Organization>,
    #[account(mut, has_one = organization)]
    pub employee: Account<'info, Employee>,
}

#[derive(Accounts)]
pub struct DepositVault<'info> {
    pub admin: Signer<'info>,
    pub organization: Account<'info, Organization>,
    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = organization.vault)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreatePayrollRun<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub organization: Account<'info, Organization>,
    #[account(
        init,
        payer = admin,
        seeds = [b"payroll_run", organization.key().as_ref(), batch_seed.key().as_ref()],
        bump,
        space = 8 + PayrollRun::INIT_SPACE
    )]
    pub payroll_run: Account<'info, PayrollRun>,
    /// CHECK: entropy account or signer used only as a deterministic run seed.
    pub batch_seed: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("prepare_payroll_run", admin)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueuePayrollComputation<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut, has_one = organization)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = admin,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PREPARE_PAYROLL_RUN))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("validate_payroll_run", admin)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueValidatePayrollRun<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut, has_one = organization)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = admin,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VALIDATE_PAYROLL_RUN))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("seal_employee_paystub", admin)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueSealEmployeePaystub<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(mut, has_one = organization)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
    #[account(mut, has_one = payroll_run)]
    pub payout: Box<Account<'info, PayrollPayout>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = admin,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SEAL_EMPLOYEE_PAYSTUB))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("prepare_payroll_run")]
#[derive(Accounts)]
pub struct PreparePayrollRunCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PREPARE_PAYROLL_RUN))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: checked by the Arcium callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
}

#[callback_accounts("validate_payroll_run")]
#[derive(Accounts)]
pub struct ValidatePayrollRunCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VALIDATE_PAYROLL_RUN))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: checked by the Arcium callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
}

#[callback_accounts("seal_employee_paystub")]
#[derive(Accounts)]
pub struct SealEmployeePaystubCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SEAL_EMPLOYEE_PAYSTUB))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: checked by the Arcium callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
    #[account(mut, has_one = payroll_run)]
    pub payout: Box<Account<'info, PayrollPayout>>,
}

#[derive(Accounts)]
pub struct CreatePayrollPayout<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub organization: Box<Account<'info, Organization>>,
    #[account(has_one = organization)]
    pub payroll_run: Box<Account<'info, PayrollRun>>,
    #[account(has_one = organization)]
    pub employee: Box<Account<'info, Employee>>,
    #[account(
        init,
        payer = admin,
        seeds = [b"payout", payroll_run.key().as_ref(), employee.key().as_ref()],
        bump,
        space = 8 + PayrollPayout::INIT_SPACE
    )]
    pub payout: Box<Account<'info, PayrollPayout>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecutePayroll<'info> {
    pub admin: Signer<'info>,
    pub organization: Account<'info, Organization>,
    #[account(mut, has_one = organization)]
    pub payroll_run: Account<'info, PayrollRun>,
    #[account(mut, address = organization.vault)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelPayrollRun<'info> {
    pub admin: Signer<'info>,
    pub organization: Account<'info, Organization>,
    #[account(mut, has_one = organization)]
    pub payroll_run: Account<'info, PayrollRun>,
}

#[account]
#[derive(InitSpace)]
pub struct Organization {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    #[max_len(48)]
    pub name: String,
    pub bump: u8,
    pub created_at: i64,
}

impl Organization {
    pub const MAX_NAME_LEN: usize = 48;
}

#[account]
#[derive(InitSpace)]
pub struct Employee {
    pub organization: Pubkey,
    pub wallet: Pubkey,
    pub status: EmployeeStatus,
    pub metadata_hash: [u8; 32],
    pub department_hash: [u8; 32],
    pub role_hash: [u8; 32],
    pub encrypted_compensation_ref: EncryptedRef,
    pub created_at: i64,
    pub updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct PayrollRun {
    pub organization: Pubkey,
    pub period_start: i64,
    pub period_end: i64,
    pub batch_hash: [u8; 32],
    pub employee_count: u32,
    pub status: PayrollRunStatus,
    pub encrypted_prepared_payroll: Option<SharedEncryptedTwo>,
    pub encrypted_validation_result: Option<SharedEncryptedThree>,
    pub encrypted_aggregate_net_pay: Option<EncryptedRef>,
    pub prepare_computation_account: Pubkey,
    pub validate_computation_account: Pubkey,
    pub seal_computation_account: Pubkey,
    pub computation_account: Pubkey,
    pub callback_signature: Option<[u8; 64]>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct PayrollPayout {
    pub payroll_run: Pubkey,
    pub employee: Pubkey,
    pub employee_wallet: Pubkey,
    pub encrypted_net_pay: Option<SharedEncryptedTwo>,
    pub status: PayoutStatus,
    pub signature: Option<[u8; 64]>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EmployeeStatus {
    Active,
    Suspended,
    Terminated,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PayrollRunStatus {
    Draft,
    Preparing,
    Prepared,
    Validating,
    Queued,
    Computing,
    Validated,
    SealingPaystubs,
    ReadyToPay,
    Paid,
    Failed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PayoutStatus {
    Pending,
    Sealing,
    Ready,
    Paid,
    Failed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct EncryptedRef {
    pub owner: EncryptionOwner,
    pub nonce: [u8; 16],
    pub ciphertext_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct SharedEncryptedTwo {
    pub owner: EncryptionOwner,
    pub encryption_key: [u8; 32],
    pub nonce: u128,
    pub ciphertext_hashes: [[u8; 32]; 2],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct SharedEncryptedThree {
    pub owner: EncryptionOwner,
    pub encryption_key: [u8; 32],
    pub nonce: u128,
    pub ciphertext_hashes: [[u8; 32]; 3],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum EncryptionOwner {
    Shared,
    Mxe,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PayrollCallbackOutput {
    pub valid: bool,
    pub encrypted_aggregate_net_pay: EncryptedRef,
    pub callback_signature: [u8; 64],
}

fn require_admin(organization: &Account<Organization>, admin: &Signer) -> Result<()> {
    require_keys_eq!(organization.admin, admin.key(), ErrorCode::Unauthorized);
    Ok(())
}

fn transition(from: &PayrollRunStatus, to: PayrollRunStatus) -> Result<()> {
    let allowed = matches!(
        (from, to),
        (PayrollRunStatus::Draft, PayrollRunStatus::Preparing)
            | (PayrollRunStatus::Preparing, PayrollRunStatus::Prepared)
            | (PayrollRunStatus::Prepared, PayrollRunStatus::Validating)
            | (PayrollRunStatus::Validating, PayrollRunStatus::Validated)
            | (PayrollRunStatus::Validated, PayrollRunStatus::SealingPaystubs)
            | (PayrollRunStatus::SealingPaystubs, PayrollRunStatus::ReadyToPay)
            | (PayrollRunStatus::ReadyToPay, PayrollRunStatus::Paid)
            | (PayrollRunStatus::Preparing, PayrollRunStatus::Failed)
            | (PayrollRunStatus::Validating, PayrollRunStatus::Failed)
            | (PayrollRunStatus::SealingPaystubs, PayrollRunStatus::Failed)
    );
    require!(allowed, ErrorCode::InvalidStatusTransition);
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("The organization name is too long.")]
    NameTooLong,
    #[msg("Only the organization admin can perform this action.")]
    Unauthorized,
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("The pay period is invalid.")]
    InvalidPayPeriod,
    #[msg("Payroll run must include at least one employee.")]
    EmptyPayrollRun,
    #[msg("The payroll run is not in the required status.")]
    InvalidStatusTransition,
    #[msg("The payroll run belongs to another organization.")]
    InvalidOrganization,
    #[msg("The encrypted batch hash does not match the payroll run.")]
    BatchHashMismatch,
    #[msg("Payroll must be validated by Arcium before execution.")]
    PayrollNotValidated,
    #[msg("Payroll must have sealed paystubs before execution.")]
    PayrollNotReady,
    #[msg("The Arcium computation was aborted.")]
    AbortedComputation,
    #[msg("The Arcium cluster is not set.")]
    ClusterNotSet,
    #[msg("The payroll run is missing prepared encrypted payroll output.")]
    MissingPreparedPayroll,
    #[msg("The payout account does not match the payroll run.")]
    InvalidPayout,
}
