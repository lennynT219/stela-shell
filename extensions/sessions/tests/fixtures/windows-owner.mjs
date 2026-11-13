import { WindowsTransport } from "../../transport-windows.ts";
const transport = await WindowsTransport.open(process.argv[2], {name:"owner",sessionId:"owner",cwd:process.cwd()}, () => "accepted");
process.stdout.write(JSON.stringify({id:transport.info.id,nativePid:transport.bridge.pid})+"\n");
process.stdin.resume();
process.stdin.on("end",async()=>{await transport.close();process.exit(0);});
