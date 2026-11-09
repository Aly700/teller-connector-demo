import type { EvalCase, Provider, ProviderReply } from '../eval/run.ts';
// Only tests import this provider. Neither the CLI nor the Worker can select it.
export class StubProvider implements Provider {
 readonly kind='stub' as const;readonly model='test-only-stub';
 constructor(private modes:Record<string,'wrong'|'invalid'|'rejection'>={}){}
 async call(c:EvalCase):Promise<ProviderReply>{
  const mode=this.modes[c.id];if(mode==='rejection')throw new Error('PROVIDER_REJECTED');
  const selection=mode==='wrong'?{tool:'get_account',arguments:{account:'reserve'}}:c.expected.selection;
  return {model:this.model,inputTokens:0,outputTokens:0,content:mode==='invalid'?[]:'refusal' in selection?[{type:'text',text:JSON.stringify(selection)}]:[{type:'tool_use',name:selection.tool,input:selection.arguments}]};
 }
}
