//! Arcium Arcis confidential instruction design for SILENCE.
//!
//! This module is intentionally kept as portable Rust-shaped logic until the
//! generated Arcium workspace is merged. The production version should be
//! emitted by `arcium init` / `arcium build` and wired into `queue_payroll_computation`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlainPayrollLine {
    pub gross_pay: u64,
    pub bonus: u64,
    pub deductions: u64,
    pub adjustments: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PreparedPayrollLine {
    pub net_pay: u64,
    pub valid: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayrollValidation {
    pub valid: bool,
    pub total_net_pay: u64,
    pub employee_count: u32,
}

pub fn prepare_payroll_run(lines: &[PlainPayrollLine]) -> Vec<PreparedPayrollLine> {
    lines
        .iter()
        .map(|line| {
            let earnings = line.gross_pay.saturating_add(line.bonus).saturating_add(line.adjustments);
            let valid = earnings >= line.deductions;
            PreparedPayrollLine {
                net_pay: earnings.saturating_sub(line.deductions),
                valid,
            }
        })
        .collect()
}

pub fn validate_payroll_run(lines: &[PreparedPayrollLine], vault_balance: u64, expected_employee_count: u32) -> PayrollValidation {
    let total_net_pay = lines.iter().fold(0_u64, |total, line| total.saturating_add(line.net_pay));
    let all_lines_valid = lines.iter().all(|line| line.valid);
    let employee_count = lines.len() as u32;

    PayrollValidation {
        valid: all_lines_valid && total_net_pay <= vault_balance && employee_count == expected_employee_count,
        total_net_pay,
        employee_count,
    }
}

pub fn seal_employee_paystub(net_pay: u64, recipient_shared_key_hash: [u8; 32]) -> ([u8; 32], u64) {
    // Placeholder for Arcium sealing/re-encryption. The generated circuit should
    // return `Enc<Shared, Paystub>` for the employee/admin recipient.
    (recipient_shared_key_hash, net_pay)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_net_pay_without_revealing_onchain_amount_policy() {
        let prepared = prepare_payroll_run(&[PlainPayrollLine {
            gross_pay: 8_400,
            bonus: 550,
            deductions: 920,
            adjustments: 0,
        }]);

        assert_eq!(
            prepared,
            vec![PreparedPayrollLine {
                net_pay: 8_030,
                valid: true
            }]
        );
    }

    #[test]
    fn validation_fails_when_vault_is_underfunded() {
        let validation = validate_payroll_run(
            &[PreparedPayrollLine {
                net_pay: 10_000,
                valid: true,
            }],
            9_999,
            1,
        );

        assert!(!validation.valid);
    }
}
