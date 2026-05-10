use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct PayrollLine {
        gross_pay: u64,
        bonus: u64,
        deductions: u64,
        adjustments: u64,
    }

    pub struct PreparedPayrollLine {
        net_pay: u64,
        valid: bool,
    }

    pub struct PayrollValidation {
        total_net_pay: u64,
        employee_count: u32,
        valid: bool,
    }

    #[instruction]
    pub fn prepare_payroll_run(input_ctxt: Enc<Shared, PayrollLine>) -> Enc<Shared, PreparedPayrollLine> {
        let input = input_ctxt.to_arcis();
        let earnings = input.gross_pay + input.bonus + input.adjustments;
        let valid = earnings >= input.deductions;
        let net_pay = if valid { earnings - input.deductions } else { 0 };

        input_ctxt.owner.from_arcis(PreparedPayrollLine { net_pay, valid })
    }

    #[instruction]
    pub fn validate_payroll_run(
        prepared_ctxt: Enc<Shared, PreparedPayrollLine>,
        vault_balance_ctxt: Enc<Shared, u64>,
        expected_employee_count: u32,
    ) -> Enc<Shared, PayrollValidation> {
        let prepared = prepared_ctxt.to_arcis();
        let vault_balance = vault_balance_ctxt.to_arcis();
        let valid = prepared.valid && prepared.net_pay <= vault_balance && expected_employee_count == 1;

        prepared_ctxt.owner.from_arcis(PayrollValidation {
            total_net_pay: prepared.net_pay,
            employee_count: 1,
            valid,
        })
    }

    #[instruction]
    pub fn seal_employee_paystub(
        prepared_ctxt: Enc<Shared, PreparedPayrollLine>,
    ) -> Enc<Shared, PreparedPayrollLine> {
        let prepared = prepared_ctxt.to_arcis();
        prepared_ctxt.owner.from_arcis(prepared)
    }
}
