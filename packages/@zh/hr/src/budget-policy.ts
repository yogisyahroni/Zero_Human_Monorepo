export type BudgetPolicyInput = {
  globalSpent: number;
  globalLimit: number;
  approvalThreshold: number;
  agentSpent: number;
  agentLimit: number;
};

export type BudgetPolicyDecision = {
  thresholdCrossed: boolean;
  globalExhausted: boolean;
  agentExhausted: boolean;
};

export function evaluateBudgetPolicy(input: BudgetPolicyInput): BudgetPolicyDecision {
  return {
    thresholdCrossed: input.approvalThreshold > 0 && input.globalSpent >= input.approvalThreshold,
    globalExhausted: input.globalSpent >= input.globalLimit,
    agentExhausted: input.agentSpent >= input.agentLimit
  };
}
