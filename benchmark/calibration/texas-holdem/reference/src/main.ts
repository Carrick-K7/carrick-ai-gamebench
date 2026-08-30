import "./style.css";
import type { CarrickGameBenchBridge, JsonValue } from "./bridge";

type Suit = "c" | "d" | "h" | "s";
type Card = `${string}${Suit}`;
type Street = "preflop" | "flop" | "turn" | "river";
type Phase = "menu" | "betting" | "showdown" | "complete";
type PlayerStatus = "active" | "folded" | "all-in" | "out";
type ActionKind = "small-blind" | "big-blind" | "fold" | "check" | "call" | "raise" | "all-in" | "refund";
type Category = "high-card" | "one-pair" | "two-pair" | "three-of-a-kind" | "straight" | "flush" | "full-house" | "four-of-a-kind" | "straight-flush";

interface Player { seat:number; id:"human"|`bot-${number}`; name:string; isHuman:boolean; stack:number; holeCards:Card[]; status:PlayerStatus; streetBet:number; handContribution:number; actedSinceFullRaise:boolean }
interface Action { seq:number; seat:number; street:Street; kind:ActionKind; amount:number; to:number }
interface Rank { seat:number; category:Category; rankVector:number[]; bestFive:Card[] }
interface Payout { seat:number; amount:number; potIndex:number }
interface Pot { amount:number; eligibleSeats:number[] }
interface Legal { canFold:boolean; canCheck:boolean; callAmount:number; canRaise:boolean; minRaiseTo:number; maxRaiseTo:number; canAllIn:boolean }
interface RankingSample { id:string; cards:Card[]; category:Category; rankVector:number[]; bestFive:Card[] }
interface GameState { scenario:string; handNumber:number; phase:Phase; street:Street; dealerSeat:number; smallBlindSeat:number; bigBlindSeat:number; actionSeat:number|null; smallBlind:number; bigBlind:number; currentBet:number; minRaiseIncrement:number; potTotal:number; totalChips:number; board:Card[]; deckRemaining:number; players:Player[]; pots:Pot[]; legal:Legal; actionLog:Action[]; showdown:{complete:boolean;ranks:Rank[];payouts:Payout[]}; rankingSamples:RankingSample[] }
interface PlayerAction { kind:"fold"|"check"|"call"|"all-in"|"raise"; to?:number }

const CATEGORIES: Category[] = ["high-card","one-pair","two-pair","three-of-a-kind","straight","flush","full-house","four-of-a-kind","straight-flush"];
const RANKS = "23456789TJQKA";
const SUITS:Suit[] = ["c","d","h","s"];
const emptyLegal = ():Legal => ({canFold:false,canCheck:false,callAmount:0,canRaise:false,minRaiseTo:0,maxRaiseTo:0,canAllIn:false});
const cardValue = (card:Card):number => RANKS.indexOf(card[0]!) + 2;
const compareVectors = (a:number[], b:number[]):number => { for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]??0)-(b[i]??0); if(d) return d; } return 0; };

function evaluateFive(cards:Card[]):Omit<Rank,"seat"> {
  const sorted=[...cards].sort((a,b)=>cardValue(b)-cardValue(a));
  const groups=new Map<number,Card[]>();
  for(const c of sorted){ const v=cardValue(c); groups.set(v,[...(groups.get(v)??[]),c]); }
  const grouped=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length || b[0]-a[0]);
  const flush=cards.every(c=>c[1]===cards[0]![1]);
  const unique=[...new Set(sorted.map(cardValue))].sort((a,b)=>b-a);
  if(unique.includes(14)) unique.push(1);
  let straightHigh=0;
  for(let i=0;i<=unique.length-5;i++) if(unique[i]!-unique[i+4]===4){ straightHigh=unique[i]!; break; }
  let category:Category; let vector:number[]; let best:Card[];
  if(flush&&straightHigh){ category="straight-flush"; vector=[8,straightHigh]; best=straightCards(sorted,straightHigh); }
  else if(grouped[0]![1].length===4){ const q=grouped[0]!; const k=grouped.find(g=>g[1].length===1)!; category="four-of-a-kind"; vector=[7,q[0],k[0]]; best=[...q[1],k[1][0]!]; }
  else if(grouped[0]![1].length===3&&grouped[1]![1].length===2){ const t=grouped[0]!,p=grouped[1]!;category="full-house";vector=[6,t[0],p[0]];best=[...t[1],...p[1]]; }
  else if(flush){ category="flush";vector=[5,...sorted.map(cardValue)];best=sorted; }
  else if(straightHigh){ category="straight";vector=[4,straightHigh];best=straightCards(sorted,straightHigh); }
  else if(grouped[0]![1].length===3){ const t=grouped[0]!,ks=grouped.filter(g=>g[1].length===1).slice(0,2);category="three-of-a-kind";vector=[3,t[0],...ks.map(k=>k[0])];best=[...t[1],...ks.map(k=>k[1][0]!)]; }
  else if(grouped[0]![1].length===2&&grouped[1]![1].length===2){ const ps=grouped.filter(g=>g[1].length===2).slice(0,2),k=grouped.find(g=>g[1].length===1)!;category="two-pair";vector=[2,ps[0]![0],ps[1]![0],k[0]];best=[...ps[0]![1],...ps[1]![1],k[1][0]!]; }
  else if(grouped[0]![1].length===2){ const p=grouped[0]!,ks=grouped.filter(g=>g[1].length===1).slice(0,3);category="one-pair";vector=[1,p[0],...ks.map(k=>k[0])];best=[...p[1],...ks.map(k=>k[1][0]!)]; }
  else { category="high-card";vector=[0,...sorted.map(cardValue)];best=sorted; }
  return {category,rankVector:vector,bestFive:best};
}
function straightCards(sorted:Card[], high:number):Card[]{ const values=high===5?[5,4,3,2,14]:[high,high-1,high-2,high-3,high-4]; return values.map(v=>sorted.find(c=>cardValue(c)===v)!); }
function evaluateSeven(cards:Card[], seat=0):Rank {
  if(cards.length<5) throw new Error("At least five cards are required");
  let best:Omit<Rank,"seat">|null=null;
  const choose=(start:number,picked:Card[]):void=>{ if(picked.length===5){const rank=evaluateFive(picked);if(!best||compareVectors(rank.rankVector,best.rankVector)>0)best=rank;return;} for(let i=start;i<=cards.length-(5-picked.length);i++)choose(i+1,[...picked,cards[i]!]);};
  choose(0,[]); return {seat,...best!};
}
function rankingSamples():RankingSample[]{
  const specs:[string,Card[]][]=[
    ["high-card",["As","Jd","9c","7h","4s","3d","2c"]],
    ["one-pair",["As","Ad","Kc","Qh","9s","3d","2c"]],
    ["two-pair",["As","Ad","Kc","Kh","9s","3d","2c"]],
    ["three-of-a-kind",["As","Ad","Ac","Kc","Qh","3d","2c"]],
    ["straight",["As","2d","3c","4h","5s","Kd","Qc"]],
    ["flush",["As","Js","9s","4s","2s","Kd","Qc"]],
    ["full-house",["As","Ad","Ac","Kc","Kh","3d","2c"]],
    ["four-of-a-kind",["As","Ad","Ac","Ah","Kc","3d","2c"]],
    ["straight-flush",["9s","Ts","Js","Qs","Ks","2d","Ac"]]
  ];
  return specs.map(([id,cards])=>{const r=evaluateSeven(cards);return{id,cards,category:r.category,rankVector:r.rankVector,bestFive:r.bestFive};});
}

class PokerGame {
  seed=0; tick=0; score=0; events:{seq:number;type:string}[]=[]; state!:GameState; private deck:Card[]=[]; private rng=()=>0; private advanceRemainder=0;
  constructor(){this.reset(1,"default");}
  reset(seed:number, scenario="default"):void {
    if(!Number.isInteger(seed)) throw new Error("seed must be an integer");
    this.seed=seed;this.tick=0;this.score=0;this.events=[];this.advanceRemainder=0;this.rng=this.makeRng(seed);this.deck=this.shuffledDeck();
    this.state=this.baseState(scenario);
    switch(scenario){
      case "blinds-order": this.startHand(3); break;
      case "facing-raise": this.setupFacingRaise(); break;
      case "short-allin": this.setupShortAllIn(); break;
      case "three-way-side-pot": this.setupSidePot(); break;
      case "ranking": this.state.rankingSamples=rankingSamples(); break;
      case "split-pot": this.setupSplitPot(); break;
      case "fold-win": this.setupFoldWin(); break;
      case "check-input": this.setupCheckInput(); break;
      case "bot-cadence": this.setupBotCadence(); break;
      default: this.startHand(Math.abs(seed)%6); break;
    }
    this.refresh();
  }
  private makeRng(seed:number):()=>number { let a=seed>>>0; return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}; }
  private shuffledDeck():Card[]{ const d:Card[]=[];for(const r of RANKS)for(const s of SUITS)d.push(`${r}${s}` as Card);for(let i=d.length-1;i>0;i--){const j=Math.floor(this.rng()*(i+1));[d[i],d[j]]=[d[j]!,d[i]!];}return d; }
  private players(stacks:number[]=Array(6).fill(200)):Player[]{ return stacks.map((stack,seat)=>({seat,id:seat===0?"human":`bot-${seat}` as `bot-${number}`,name:seat===0?"You":["","Mara","Theo","June","Ivo","Sage"][seat]!,isHuman:seat===0,stack,holeCards:[],status:stack>0?"active":"out",streetBet:0,handContribution:0,actedSinceFullRaise:false})); }
  private baseState(scenario:string):GameState { return {scenario,handNumber:0,phase:"menu",street:"preflop",dealerSeat:5,smallBlindSeat:0,bigBlindSeat:1,actionSeat:null,smallBlind:1,bigBlind:2,currentBet:0,minRaiseIncrement:2,potTotal:0,totalChips:1200,board:[],deckRemaining:52,players:this.players(),pots:[],legal:emptyLegal(),actionLog:[],showdown:{complete:false,ranks:[],payouts:[]},rankingSamples:[]}; }
  private emit(type:string):void{this.events.push({seq:this.events.length+1,type});}
  private draw():Card{const c=this.deck.pop();if(!c)throw new Error("Deck exhausted");return c;}
  private clockwiseAfter(seat:number,predicate:(p:Player)=>boolean):number|null { for(let n=1;n<=6;n++){const s=(seat+n)%6;if(predicate(this.state.players[s]!))return s;}return null; }
  private live(p:Player):boolean{return p.status!=="out";}
  private actionable(p:Player):boolean{return p.status==="active"&&p.stack>0;}
  private postBlind(seat:number, amount:number, kind:"small-blind"|"big-blind"):void { const p=this.state.players[seat]!;const paid=Math.min(p.stack,amount);p.stack-=paid;p.streetBet+=paid;p.handContribution+=paid;if(p.stack===0)p.status="all-in";this.log(seat,kind,paid,p.streetBet); }
  startHand(dealer?:number):void {
    if(this.state.phase!=="menu"&&this.state.phase!=="complete")throw new Error("A hand is already running");
    if(dealer!==undefined)this.state.dealerSeat=dealer;this.state.handNumber+=1;this.state.phase="betting";this.state.street="preflop";this.state.board=[];this.state.actionLog=[];this.state.showdown={complete:false,ranks:[],payouts:[]};this.state.pots=[];this.state.currentBet=0;this.state.minRaiseIncrement=2;
    for(const p of this.state.players){p.holeCards=[];p.streetBet=0;p.handContribution=0;p.actedSinceFullRaise=false;p.status=p.stack>0?"active":"out";}
    const live=this.state.players.filter(p=>this.live(p));if(live.length<2){this.state.phase="complete";this.state.actionSeat=null;this.refresh();return;}
    const sb=live.length===2?this.state.dealerSeat:this.clockwiseAfter(this.state.dealerSeat,p=>this.live(p))!;
    const bb=this.clockwiseAfter(sb,p=>this.live(p))!;this.state.smallBlindSeat=sb;this.state.bigBlindSeat=bb;
    for(let round=0;round<2;round++)for(let n=1;n<=6;n++){const s=(this.state.dealerSeat+n)%6,p=this.state.players[s]!;if(this.live(p))p.holeCards.push(this.draw());}
    this.postBlind(sb,1,"small-blind");this.postBlind(bb,2,"big-blind");this.state.currentBet=Math.max(...this.state.players.map(p=>p.streetBet));
    this.state.actionSeat=this.clockwiseAfter(bb,p=>this.actionable(p));this.emit("hand-started");this.refresh();
  }
  private setupFacingRaise():void { const s=this.state;s.phase="betting";s.handNumber=1;s.dealerSeat=5;s.smallBlindSeat=0;s.bigBlindSeat=1;s.actionSeat=0;s.currentBet=20;s.minRaiseIncrement=18;s.players[0]!.stack=198;s.players[0]!.streetBet=2;s.players[0]!.handContribution=2;s.players[1]!.stack=180;s.players[1]!.streetBet=20;s.players[1]!.handContribution=20;s.potTotal=22;s.actionLog=[];s.deckRemaining=40; }
  private setupShortAllIn():void { const s=this.state;s.phase="betting";s.handNumber=1;s.dealerSeat=5;s.actionSeat=1;s.currentBet=20;s.minRaiseIncrement=10;for(const p of s.players)p.status=p.seat<2?"active":"folded";Object.assign(s.players[0]!,{stack:180,streetBet:20,handContribution:20,actedSinceFullRaise:true});Object.assign(s.players[1]!,{stack:5,streetBet:20,handContribution:20,actedSinceFullRaise:false});s.potTotal=40;s.actionLog=[];s.deckRemaining=40; }
  private setupSidePot():void { const s=this.state;const stacks=[50,100,200,200,200,200];s.players=this.players(stacks);s.totalChips=950;s.phase="betting";s.street="river";s.handNumber=1;s.dealerSeat=5;s.actionSeat=0;s.currentBet=0;s.board=["2c","7d","9h","Js","3c"];s.deckRemaining=41;s.players[0]!.holeCards=["As","Ad"];s.players[1]!.holeCards=["Ks","Kd"];s.players[2]!.holeCards=["Qs","Qd"];for(let i=3;i<6;i++)s.players[i]!.status="folded"; }
  private setupSplitPot():void { const s=this.state;s.phase="betting";s.handNumber=1;s.dealerSeat=0;s.actionSeat=1;s.board=["As","Kd","Qh","Jc","Ts"];s.deckRemaining=41;for(const seat of [1,2,3]){const p=s.players[seat]!;p.stack=199;p.handContribution=1;p.streetBet=1;p.status=seat===2?"folded":"active";}s.players[1]!.holeCards=["2c","3c"];s.players[3]!.holeCards=["4d","5d"];s.currentBet=1;s.potTotal=3;s.pots=[{amount:3,eligibleSeats:[1,3]}]; }
  private setupFoldWin():void { const s=this.state;s.phase="betting";s.handNumber=1;s.dealerSeat=5;s.smallBlindSeat=0;s.bigBlindSeat=1;s.actionSeat=0;s.currentBet=10;s.minRaiseIncrement=8;for(const p of s.players)p.status=p.seat<2?"active":"folded";Object.assign(s.players[0]!,{stack:190,streetBet:10,handContribution:10});Object.assign(s.players[1]!,{stack:198,streetBet:2,handContribution:2});s.potTotal=12;s.actionLog=[]; }
  private setupCheckInput():void { const s=this.state;s.phase="betting";s.handNumber=1;s.dealerSeat=5;s.actionSeat=0;s.currentBet=0;s.actionLog=[];s.deckRemaining=40; }
  private setupBotCadence():void { const s=this.state;s.phase="betting";s.handNumber=1;s.dealerSeat=0;s.smallBlindSeat=5;s.bigBlindSeat=0;s.actionSeat=1;s.currentBet=2;s.minRaiseIncrement=2;s.actionLog=[];s.players[0]!.stack=198;s.players[0]!.streetBet=2;s.players[0]!.handContribution=2;s.potTotal=2;s.deckRemaining=40; }
  private log(seat:number,kind:ActionKind,amount:number,to:number):void{this.state.actionLog.push({seq:this.state.actionLog.length+1,seat,street:this.state.street,kind,amount,to});}
  private legalFor(seat:number|null):Legal { if(seat===null||this.state.phase!=="betting")return emptyLegal();const p=this.state.players[seat]!;if(!this.actionable(p))return emptyLegal();const call=Math.min(p.stack,Math.max(0,this.state.currentBet-p.streetBet));const max=p.streetBet+p.stack;const min=this.state.currentBet+this.state.minRaiseIncrement;const reopened=!p.actedSinceFullRaise;return{canFold:true,canCheck:call===0,callAmount:call,canRaise:reopened&&max>=min,minRaiseTo:reopened&&max>=min?min:0,maxRaiseTo:max,canAllIn:p.stack>0&&(max<=this.state.currentBet||reopened)}; }
  playerAction(seat:number, action:PlayerAction):void {
    if(this.state.phase!=="betting"||this.state.actionSeat!==seat)throw new Error(`Seat ${seat} is not the current actor`);
    const p=this.state.players[seat]!, legal=this.legalFor(seat), beforeBet=p.streetBet;
    if(action.kind==="fold"){if(!legal.canFold)throw new Error("Fold is illegal");p.status="folded";p.actedSinceFullRaise=true;this.log(seat,"fold",0,0);}
    else if(action.kind==="check"){if(!legal.canCheck)throw new Error("Check is illegal while facing a bet");p.actedSinceFullRaise=true;this.log(seat,"check",0,0);}
    else if(action.kind==="call"){if(legal.callAmount<=0)throw new Error("Nothing to call");this.commit(p,legal.callAmount);p.actedSinceFullRaise=true;this.log(seat,"call",legal.callAmount,p.streetBet);}
    else if(action.kind==="raise"){
      if(typeof action.to!=="number"||!Number.isInteger(action.to))throw new Error("Raise-to must be an integer");const to=action.to;if(!legal.canRaise||to<legal.minRaiseTo||to>legal.maxRaiseTo)throw new Error(`Illegal raise to ${to}`);
      const amount=to-beforeBet, increment=to-this.state.currentBet;this.commit(p,amount);this.state.currentBet=to;this.state.minRaiseIncrement=increment;for(const other of this.state.players)if(other.seat!==seat&&this.actionable(other))other.actedSinceFullRaise=false;p.actedSinceFullRaise=true;this.log(seat,"raise",amount,to);
    } else {
      if(!legal.canAllIn)throw new Error("All-in is illegal");const amount=p.stack,to=p.streetBet+amount,oldBet=this.state.currentBet;this.commit(p,amount);const increment=to-oldBet;
      if(to>oldBet){this.state.currentBet=to;if(increment>=this.state.minRaiseIncrement){this.state.minRaiseIncrement=increment;for(const other of this.state.players)if(other.seat!==seat&&this.actionable(other))other.actedSinceFullRaise=false;}}
      p.actedSinceFullRaise=true;this.log(seat,"all-in",amount,to);
    }
    this.afterAction(seat);this.refresh();
  }
  private commit(p:Player,amount:number):void{if(amount<0||amount>p.stack)throw new Error("Invalid chip commitment");p.stack-=amount;p.streetBet+=amount;p.handContribution+=amount;if(p.stack===0)p.status="all-in";}
  private afterAction(seat:number):void {
    const contenders=this.state.players.filter(p=>p.status!=="folded"&&p.status!=="out");
    if(contenders.length===1){this.awardUncontested(contenders[0]!.seat);return;}
    if(this.state.scenario==="three-way-side-pot"&&seat===0){this.state.actionSeat=1;return;}
    const candidates=this.state.players.filter(p=>this.actionable(p));
    const pending=candidates.filter(p=>p.streetBet!==this.state.currentBet||!p.actedSinceFullRaise);
    if(pending.length===0){this.endBettingRound();return;}
    this.state.actionSeat=this.clockwiseAfter(seat,p=>pending.some(q=>q.seat===p.seat));
  }
  private endBettingRound():void {
    if(this.state.street==="river"){this.resolveShowdown();return;}
    const next:Record<Street,Street>={preflop:"flop",flop:"turn",turn:"river",river:"river"};this.state.street=next[this.state.street];for(const p of this.state.players){p.streetBet=0;p.actedSinceFullRaise=false;}this.state.currentBet=0;this.state.minRaiseIncrement=2;
    const count=this.state.street==="flop"?3:1;for(let i=0;i<count;i++)this.state.board.push(this.draw());
    const actionables=this.state.players.filter(p=>this.actionable(p));if(actionables.length<2){while(this.state.board.length<5)this.state.board.push(this.draw());this.state.street="river";this.resolveShowdown();return;}
    this.state.actionSeat=this.clockwiseAfter(this.state.dealerSeat,p=>this.actionable(p));
  }
  private awardUncontested(seat:number):void { const amount=this.state.players.reduce((n,p)=>n+p.handContribution,0);this.state.players[seat]!.stack+=amount;this.state.showdown={complete:true,ranks:[],payouts:[{seat,amount,potIndex:0}]};for(const p of this.state.players){p.handContribution=0;p.streetBet=0;}this.state.phase="complete";this.state.actionSeat=null;this.state.pots=[];this.emit("hand-complete"); }
  private buildPots():Pot[]{
    const levels=[...new Set(this.state.players.map(p=>p.handContribution).filter(n=>n>0))].sort((a,b)=>a-b);const pots:Pot[]=[];let previous=0;
    for(const level of levels){const contributors=this.state.players.filter(p=>p.handContribution>=level);const amount=(level-previous)*contributors.length;const eligible=contributors.filter(p=>p.status!=="folded"&&p.status!=="out").map(p=>p.seat);if(contributors.length===1){const p=contributors[0]!;p.stack+=amount;this.log(p.seat,"refund",amount,p.streetBet);p.handContribution-=amount;}else if(amount>0)pots.push({amount,eligibleSeats:eligible});previous=level;}
    return pots;
  }
  private resolveShowdown():void {
    this.state.phase="showdown";while(this.state.board.length<5)this.state.board.push(this.draw());this.state.street="river";
    const pots=this.buildPots(), rankMap=new Map<number,Rank>();for(const p of this.state.players)if(p.status!=="folded"&&p.status!=="out")rankMap.set(p.seat,evaluateSeven([...p.holeCards,...this.state.board],p.seat));
    const payouts:Payout[]=[];
    pots.forEach((pot,potIndex)=>{const eligible=pot.eligibleSeats.filter(s=>rankMap.has(s));if(!eligible.length)return;let winners=[eligible[0]!];for(const s of eligible.slice(1)){const cmp=compareVectors(rankMap.get(s)!.rankVector,rankMap.get(winners[0]!)!.rankVector);if(cmp>0)winners=[s];else if(cmp===0)winners.push(s);}const order=this.clockwiseOrder(winners);const base=Math.floor(pot.amount/winners.length),odd=pot.amount%winners.length;order.forEach((s,i)=>{const amount=base+(i<odd?1:0);this.state.players[s]!.stack+=amount;payouts.push({seat:s,amount,potIndex});});});
    this.state.pots=pots;this.state.showdown={complete:true,ranks:[...rankMap.values()].sort((a,b)=>a.seat-b.seat),payouts};for(const p of this.state.players){p.handContribution=0;p.streetBet=0;}this.state.phase="complete";this.state.actionSeat=null;this.state.pots=[];this.emit("hand-complete");this.refresh();
  }
  private clockwiseOrder(seats:number[]):number[]{return [...seats].sort((a,b)=>((a-this.state.dealerSeat-1+6)%6)-((b-this.state.dealerSeat-1+6)%6));}
  private runBot():void {
    const seat=this.state.actionSeat;if(seat===null||seat===0||this.state.phase!=="betting")return;
    if(this.state.scenario==="split-pot"){this.resolveShowdown();return;}
    if(this.state.scenario==="three-way-side-pot"){
      if(seat===1){this.playerAction(1,{kind:"all-in"});return;}if(seat===2){this.playerAction(2,{kind:"all-in"});return;}
    }
    if(this.state.scenario==="short-allin"){this.playerAction(seat,{kind:"all-in"});return;}
    if(this.state.scenario==="bot-cadence"){
      const n=this.state.actionLog.length;if(n===0)this.playerAction(seat,{kind:"call"});else if(n===1)this.playerAction(seat,{kind:"fold"});else if(n===2)this.playerAction(seat,{kind:"raise",to:6});else this.botDefault(seat);return;
    }
    this.botDefault(seat);
  }
  private botDefault(seat:number):void { const l=this.legalFor(seat),roll=this.rng();if(l.callAmount>0&&roll<.18)this.playerAction(seat,{kind:"fold"});else if(l.canRaise&&roll>.82)this.playerAction(seat,{kind:"raise",to:l.minRaiseTo});else if(l.callAmount>0)this.playerAction(seat,{kind:"call"});else this.playerAction(seat,{kind:"check"}); }
  advance(ms:number):void { if(!Number.isInteger(ms)||ms<0)throw new Error("advance ms must be a non-negative integer");this.tick+=ms;this.advanceRemainder+=ms;while(this.advanceRemainder>=250){this.advanceRemainder-=250;if(this.state.actionSeat!==null&&this.state.actionSeat!==0)this.runBot();}this.refresh(); }
  newHand():void {if(this.state.phase!=="complete")throw new Error("Current hand is not complete");const next=this.clockwiseAfter(this.state.dealerSeat,p=>p.stack>0);if(next===null)throw new Error("Not enough players");this.startHand(next);}
  restartTable():void {this.reset(this.seed,"default");}
  private refresh():void { this.state.potTotal=this.state.players.reduce((n,p)=>n+p.handContribution,0);this.state.deckRemaining=this.deck.length;this.state.legal=this.legalFor(this.state.actionSeat===0?0:null); }
  snapshot():{status:"menu"|"running"|"won"|"lost";tick:number;score:number;seed:number;state:GameState;events:{seq:number;type:string}[]}{ this.refresh();return structuredClone({status:this.state.phase==="menu"?"menu":"running",tick:this.tick,score:this.score,seed:this.seed,state:this.state,events:this.events}); }
}

const game=new PokerGame();
const appElement=document.querySelector<HTMLElement>("#app");if(!appElement)throw new Error("#app is missing");const app:HTMLElement=appElement;
const suitGlyph=(c:Card)=>({c:"♣",d:"♦",h:"♥",s:"♠"}[c[1] as Suit]);
const cardHtml=(c?:Card,back=false)=>back?'<span class="card back"></span>':c?`<span class="card ${c[1]==="d"||c[1]==="h"?"red":""}">${c[0]}${suitGlyph(c)}</span>`:'<span class="card empty"></span>';
function render():void{
  const s=game.state,l=s.legal,last=s.actionLog.at(-1);const seats=s.players.map(p=>`<article class="seat seat-${p.seat} ${s.actionSeat===p.seat?"current":""} ${p.status==="folded"?"folded":""}"><div class="seat-top"><span class="name">${p.name}</span><span class="stack">◉ ${p.stack}</span></div><div class="seat-detail"><span>${p.status}${p.streetBet?` · bet ${p.streetBet}`:""}</span><span class="markers">${s.dealerSeat===p.seat?'<i class="marker">D</i>':""}${s.smallBlindSeat===p.seat?'<i class="marker blind">SB</i>':""}${s.bigBlindSeat===p.seat?'<i class="marker blind">BB</i>':""}</span></div><div class="hole">${p.holeCards.map(c=>cardHtml(c,p.seat!==0&&s.phase!=="complete")).join("")}</div></article>`).join("");
  app.innerHTML=`<section class="game"><header><div><h1>RIVERSTONE HOLD'EM</h1><div class="brand-sub">SIX SEAT CASH TABLE</div></div><div class="meta"><span>HAND<strong>#${s.handNumber}</strong></span><span>BLINDS<strong>1 / 2</strong></span><span>STREET<strong>${s.street.toUpperCase()}</strong></span></div></header><div class="stage"><div class="table"><div class="board">${Array.from({length:5},(_,i)=>cardHtml(s.board[i])).join("")}</div><div class="pot">POT&nbsp; ◉ ${s.potTotal}</div></div>${seats}</div><footer class="controls"><div class="status"><strong>${s.phase==="complete"?"Hand complete":s.actionSeat===0?"Your action":s.actionSeat===null?"Waiting":`${s.players[s.actionSeat]!.name} is thinking`}</strong>${l.callAmount?`Call ${l.callAmount}`:l.canCheck?"Check or raise":`${s.phase} · ${s.scenario}`}</div><div class="actions"><button data-action="fold" ${!l.canFold?"disabled":""}>Fold</button><button data-action="check" ${!l.canCheck?"disabled":""}>Check</button><button data-action="call" ${l.callAmount<=0?"disabled":""}>Call ${l.callAmount||""}</button><button data-action="all-in" ${!l.canAllIn?"disabled":""}>All-in</button><div class="raise-box"><input data-testid="raise-to" type="number" min="${l.minRaiseTo}" max="${l.maxRaiseTo}" value="${l.minRaiseTo||l.maxRaiseTo}" aria-label="Raise to"/><button class="primary" data-action="raise" ${!l.canRaise?"disabled":""}>Raise</button></div></div><div class="log">${last?`Last: <strong>${s.players[last.seat]!.name} ${last.kind}${last.to?` to ${last.to}`:""}</strong><br>`:""}${s.showdown.complete&&s.showdown.payouts.length?`Paid: ${s.showdown.payouts.map(p=>`${s.players[p.seat]!.name} +${p.amount}`).join(", ")}`:"Deterministic table · seed "+game.seed}</div></footer></section>`;
  for(const kind of ["fold","check","call","all-in"] as const)document.querySelector(`[data-action="${kind}"]`)?.addEventListener("click",()=>dispatchHuman({kind}));
  document.querySelector('[data-action="raise"]')?.addEventListener("click",()=>{const input=document.querySelector<HTMLInputElement>('[data-testid="raise-to"]');dispatchHuman({kind:"raise",to:Number(input?.value)});});
}
function dispatchHuman(action:PlayerAction):void{try{game.playerAction(0,action);render();}catch(error){console.error(error);throw error;}}

const bridge:CarrickGameBenchBridge={version:"1",ready:Promise.resolve(),async reset(input){game.reset(input.seed,input.scenario);render();},async act(input){
  if(input.type==="player-action"){const payload=input.payload as unknown as PlayerAction;if(!payload||typeof payload.kind!=="string")throw new Error("Invalid player action");game.playerAction(0,payload);}
  else if(input.type==="start-hand")game.startHand();else if(input.type==="new-hand")game.newHand();else if(input.type==="restart-table")game.restartTable();else throw new Error(`Unknown action: ${input.type}`);render();
},async advance(ms){game.advance(ms);render();},async snapshot(){return game.snapshot() as unknown as Awaited<ReturnType<CarrickGameBenchBridge["snapshot"]>>;}};
window.__CARRICK_GAMEBENCH__=bridge;render();
