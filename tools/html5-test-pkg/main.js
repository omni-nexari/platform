(function(){
  function pad(n){return n<10?'0'+n:''+n;}
  var start=Date.now();
  var fill=document.getElementById('fill');
  var clock=document.getElementById('clock');
  function tick(){
    var now=new Date();
    clock.textContent=pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
    var pct=((Date.now()-start)%10000)/100;
    fill.style.width=pct.toFixed(1)+'%';
  }
  setInterval(tick,1000);
  tick();
})();
