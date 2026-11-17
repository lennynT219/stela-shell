// Isolated fake CLI. Never reads a real vault/configuration or launches descendants.
const mode = process.argv[2], args = process.argv.slice(3);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const req = JSON.parse(input);
const limit = flag => Number(args[args.indexOf(flag) + 1]);
const id = "550e8400-e29b-41d4-a716-446655440010";
const state = { status:"found", memory_id:req.arguments.memory_id ?? id, revision:1, accepted_markdown:"Exact 😀\r\ncontext\n", observed_markdown:null, approval_candidate:null, reason:null };
const saved = { status:"saved", memory_id:req.arguments.memory_id ?? id, revision:1, request_id:req.request_id };
const capabilities = { status:"found", protocol_version:1, brain_version:"fixture",
  operations:["capabilities","resolve","read","create","replace_missing","update","accept_external","inspect_recovery","recover"],
  max_input_bytes:limit("--max-input-bytes"), max_output_bytes:limit("--max-output-bytes"),
  history_version:1, document_version:1, lock:"std_try_lock", authority:"trusted_local_caller",
  cancellation:"host_terminates_process; mutation_confirmation_may_be_lost" };
let result = req.operation === "capabilities" ? capabilities : req.operation === "read" ? state : saved;
if (req.operation === "resolve") result = {status:"unbound",directory:process.cwd()};
if (req.operation === "replace_missing") result.replaced_memory_id = req.arguments.expected_memory_id;
if (req.operation === "inspect_recovery") result = { status:"partial",reason:"history_corrupt",observation:{
  memory_id:req.arguments.memory_id,current:"Untrusted 😀\r\n",history:null,pending:null,marker:null,reservation:null,history_bytes:[255,128,0],history_corrupt:true } };
if (mode === "logical-error") result = {status:"conflict",message:"Untrusted diagnostic"};
if (mode === "too-large") result = {status:"too_large",message:"complete response exceeds transport bound",required_bytes:9000};
if (mode === "wide") result = {...state,revision:JSON.rawJSON("18446744073709551615")};
if (mode === "wide-input") {
  const exact = input.includes('"revision":9007199254740993');
  result = exact ? {...saved,revision:2} : {status:"invalid",message:"rounded input"};
}
if (mode === "wrong-identity") result.memory_id = "550e8400-e29b-41d4-a716-446655440099";
if (mode === "recovery") result.request_id = "550e8400-e29b-41d4-a716-446655440098";
if (mode === "wait") { process.stderr.write("READY"); setInterval(()=>{},1000); await new Promise(()=>{}); }
if (mode === "stderr") process.stderr.write("DO_NOT_ECHO".repeat(2000));
let response = {protocol_version:1,request_id:req.request_id,operation:req.operation,result};
if (mode === "wrong-id") response.request_id = "550e8400-e29b-41d4-a716-446655440099";
if (mode === "wrong-operation") response.operation = "resolve";
if (mode === "wrong-version") response.protocol_version = 2;
if (mode === "missing-correlation") response.request_id = null;
if (mode === "extra") response.extra = "DO_NOT_ECHO";
if (mode === "status-only") response.result = {status:"saved"};
if (mode === "unsupported-capability") response.result.history_version = 2;
let output = JSON.stringify(response);
if (mode === "duplicate") output = output.replace('"protocol_version":1','"protocol_version":2,"protocol_\\u0076ersion":1');
if (mode === "unsafe-float") output = output.replace('"revision":1','"revision":1.00000000000000001');
if (mode === "no-lf") { process.stdout.write(output); process.exit(0); }
if (mode === "truncated") output = output.slice(0,-2);
if (mode === "multiple") output += "\n" + output;
if (mode === "overflow") output = "X".repeat(5000);
if (mode === "bad-utf8") { process.stdout.write(Buffer.from([0xff,0xfe,10])); process.exit(0); }
if (mode === "bom") output = "\uFEFF" + output;
process.stdout.write(output + "\n");
if (mode === "nonzero") process.exitCode = 7;
