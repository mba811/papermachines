var _Sequence = function (onDone) {
  this.list = [];
  this.onDone = onDone;
};

_Sequence.prototype = {
  add: function() { 
    var args = Array.prototype.slice.call(arguments);
    this.list.push(args);
  },
  next: function() { 
    if (this.list.length > 0) {
      var current = this.list.shift();
      setTimeout(function () { (current.shift()).apply(this, current); }, 1);
    } else {
      if (typeof this.onDone == "function"){
        setTimeout(this.onDone, 250);
      }
    }
  }
};

var deferUntilSearchComplete = new _Sequence();

var timeFilter = function() { return true;};
var timeRanges;
var searchN = 0;

var gradientOpacity = d3.scale.pow().exponent(0.3).domain([0,2.5]).range([0,1]);

var legend, showLegend = true;
var startDate, endDate;
var activeTopicLabels = [], inactiveTopicLabels = [];
var graph = {};
var streaming = true,
    my,
    width = 1024,
    height = 600,
    wordClouds = {};

var maxStdDev = 2.5;

var origTopicTimeData,
    dataSummed,
    xAxis,
    yAxis,
    legendLabels,
    topicLabels = null,
    topicLabelsSorted,
    total = 1,
    docMetadata = {};

var dateParse = d3.time.format("%Y").parse;

var offsetLeft = 0,
    marginVertical = 100;

var x = d3.time.scale()
    .range([0, width]);
var y = d3.scale.linear()
    .range([height - marginVertical, marginVertical]);

var line, area;

generateSearch(searchN++);

var vis = d3.select("#chart")
  .append("svg:svg")
    .attr("width", width + offsetLeft + 25)
    .attr("height", height + 20);

var defs = vis.append("svg:defs");

vis = vis.append("svg:g")
    .on("click", getDocs);

var graphGroup = vis.append("svg:g").attr("id", "graphGroup");
var axesGroup = vis.append("svg:g").attr("id", "axesGroup");
var legendGroup = vis.append("svg:g").attr("id", "legendGroup");
var wordCloudGroup = vis.append("svg:g").attr("id", "wordCloudGroup")
  .attr("transform", "translate(0," + (height - 100) + ")");

origTopicTimeData = data;
dataSummed = [];
sumUpData(0, origTopicTimeData);

y.domain([-maxStdDev, maxStdDev]);

startDate = graph[0].data[0][0].x;
endDate = graph[0].data[0][graph[0].data[0].length - 1].x;

x.domain([startDate, endDate]);

line = d3.svg.line()
  .interpolate("basis")
  .x(function(d) { return x(d.x); })
  .y(function(d) { return y(d.y); });

area = d3.svg.area()
  .interpolate("basis")
  .x(function(d) { return x(d.x); })
  .y0(function(d) { return y(d.y0); })
  .y1(function(d) { return y(d.y0 + d.y); });


var layout = d3.layout.stack().offset("silhouette");

topicLabels = {};
for (i in labels) {
  topicLabels[i] = labels[i];
  topicLabels[i]["active"] = true;
}

xAxis = d3.svg.axis()
  .scale(x)
  .ticks(d3.time.years, 10)
  .tickSubdivide(5)
  .tickSize(-height, -height);

yAxis = d3.svg.axis()
  .scale(y)
  .orient("right")
  .ticks(5)
  .tickSize(width, width);

  mostCoherentTopics(5);

  setStartParameters();

function transition(toggle) {
  if (toggle) streaming = !streaming;

  // if (streaming) {
  //   createGradientScale();
  // } else {
  //   d3.select("#gradientScale").remove();
  // }

  for (i in graph) {
    sumUpData(i, origTopicTimeData);
    if (streaming) {
      graph[i].streamData = layout(graph[i].data);

        my = d3.max(graph[i].data, function(d) {
            return d3.max(d, function(d) {
              return d.y0 + d.y;
            });
        });

        y.domain([0, my]);
    }
  }

  x.domain([startDate, endDate]);
  if (!streaming) y.domain([-maxStdDev,maxStdDev])

  for (i in graph) {
    updateGradients(i);
    createOrUpdateGraph(i);
  }

  refreshAxes();
  updateLegend();

}
function shuffle(array) {
    var tmp, current, top = array.length;

    if(top) while(--top) {
        current = Math.floor(Math.random() * (top + 1));
        tmp = array[current];
        array[current] = array[top];
        array[top] = tmp;
    }

    return array;
}

function resetColors() {
  for (i in graph) {
    // var newLabelColors = shuffle(activeTopicLabels.slice());
    var newLabelColors = activeTopicLabels.slice();
    graph[i]['color'] = d3.scale.category20().domain(newLabelColors);
    updateGradients(i);
  }
  transition();
}

function sumUpData(graphIndex, origData) {
  graph[graphIndex].data = [];
  var firstRun = dataSummed.length == 0;

  origData.forEach(function (d, i) {
    if (topicLabels == null || i in topicLabels && topicLabels[i]["active"]) {
      var length = graph[graphIndex].data.push([]);
      d.forEach(function (e) {
        if (timeFilter(e)) {
          var datum = {};
          if (!Date.prototype.isPrototypeOf(e.x)) e.x = dateParse(e.x);
          datum.x = e.x;
          datum.topic = e.topic;
          datum.search = graphIndex;
          datum.y = 0.0;

          graph[graphIndex].contributingDocs[e.x.getFullYear()] = []; 

          e.y.forEach(function (f) {
            docMetadata[f.itemID] = {'title': f.title, 'year': e.x.getFullYear()};
            if (graph[graphIndex].searchFilter(f)) {
              datum.y += f.ratio;
              graph[graphIndex].contributingDocs[e.x.getFullYear()].push(f.itemID);
            }
          });

          graph[graphIndex].data[length - 1].push(datum);
        }
      });
    }
  });

    graph[graphIndex].data.forEach(function (d,i) {
      d.forEach(function (e) {
        var s = graph[graphIndex].contributingDocs[e.x.getFullYear()].length || 1;

        // s is both the total number of docs in a given year and the sum of all topics
        // for that year

        if (!streaming) { // find standard score
          e.y /= s;
          e.y -= topicProportions[d[0].topic];
          e.y /= topicStdevs[d[0].topic];

          // e.y has been standardized (although, this is a Dirichlet distribution
          // not a normal one; is there some more appropriate way to do this?)

        } else {
          e.y /= Math.sqrt(s);
        }
      });
    });
    if (firstRun) dataSummed = graph[graphIndex].data;
}

function showMore() {
  var _topics = topicLabelsSorted.slice();

  for (i in activeTopicLabels) {
    var idx = _topics.indexOf(activeTopicLabels[i]);
    _topics.splice(idx, 1);
  }

  _topics = _topics.slice(0,5);
  console.log(_topics);

  for (i in topicLabels) {
    topicLabels[i]["active"] = topicLabels[i]["active"] || _topics.indexOf(i) != -1;
  }
  transition();
}

function createOrUpdateGraph(i) {
  var graphSelection = graphGroup.selectAll("path.line.graph" + i.toString())
    .data(streaming ? graph[i].streamData : graph[i].data, function(d) { return d[0].topic;});

  graphSelection
    .attr("stroke", function(d) { return !streaming ? graph[i].color(d[0].topic) : "#000"; })
    .style("stroke-width", streaming ? "0.25" : "1.5")
    .style("stroke-opacity", streaming ? "0.3" : "1.0")
    .transition().duration(500).attr("d", streaming ? area : line);

  graphSelection.style("fill", function (d) { return streaming ? "url(#linearGradientTopic" + d[0].topic + ")": "none"; });

  var graphEntering = graphSelection.enter();
    graphEntering.append("svg:path")
        .attr("class", function (d) { return "line graph" + i.toString() + " topic"+d[0].topic.toString(); })
        .attr("stroke", function(d) { return !streaming ? graph[i].color(d[0].topic) : "#fff"; })
        .style("fill", function (d) { return streaming ? "url(#linearGradientTopic" + d[0].topic + ")": "none" })
        .style("stroke-width", streaming ? "0.5" : "1.5")
        .style("stroke-opacity", "1")
        .style("stroke-dasharray", graph[i].dasharray)
        .on("mouseover", function (d) { highlightTopic(d[0]);})
        .on("mouseout", unhighlightTopic)
        .attr("d", streaming ? area : line)
        .append("svg:title")
          .text(function (d) { return topicLabels[d[0].topic]["label"]; });

  var graphExiting = graphSelection.exit();
  graphExiting.transition().duration(500).style("stroke-opacity", "0").remove();
  graph[i].graphCreated = true;
}

function highlightTopic(e) {
  return;
  var topic = e.topic;
  for (i in graph) {
    var series = graphGroup.selectAll("path.line.graph" + i.toString());
    series.style(streaming ? "fill-opacity": "stroke-opacity", function (d) {
        return (d[0].topic == topic) ? graph[i].defaultOpacity * 0.7 : graph[i].defaultOpacity;
      });
  }
}

function unhighlightTopic() {
  return;
  for (i in graph) {
    var series = graphGroup.selectAll("path.line.graph" + i.toString());
    series.style(streaming ? "fill-opacity" : "stroke-opacity", graph[i].defaultOpacity);
  }
}

function refreshAxes() {
  if (axesGroup.select("g.x.axis").empty()) {
    axesGroup.append("svg:g")
    .attr("class", "x axis")
    .attr("transform", "translate(0," + height + ")")
    .call(xAxis);
  } else {
    axesGroup.select("g.x.axis").transition().duration(500).call(xAxis);
  }
  if (streaming) {
    axesGroup.select("g.y.axis").transition().duration(500).style("fill-opacity", 0);
    axesGroup.selectAll(".y.axis line").style("stroke-opacity", 0);
  } else {
    if (axesGroup.select("g.y.axis").empty()) {
      axesGroup.append("svg:g")
      .attr("class", "y axis")
      .attr("transform", "translate(-15,0)")
      .call(yAxis);
    } else {
      axesGroup.select("g.y.axis").transition().duration(500).style("fill-opacity", 1).call(yAxis);
      axesGroup.selectAll(".y.axis line").transition().duration(500).style("stroke-opacity", 1);
    }
  }
}
function toggleTopic(d) {
  // if (d3.event) d3.event.preventDefault();
  topicLabels[d.topic]["active"] = !topicLabels[d.topic]["active"];
  resetColors();
  transition();
}

function wordCloudPositions (d, i) {
  return "translate(" + ((i+1)*310) + ",0)";
}

function displayFullTopic(d) {
  if (d3.event) d3.event.preventDefault();
  if (d.topic in wordClouds) {
    wordCloudGroup.selectAll(".cloud" + d.topic).remove();
  } else {
    wordClouds[d.topic] = topicCloud(d.topic, wordCloudGroup);  
    wordCloudGroup.selectAll("g").attr("transform", wordCloudPositions)
  }
}

function updateLegend() {
  // legendGroup.select("#legend").remove();

  if (legendGroup.select("#legend").empty()) {
    legend = legendGroup.append("svg:g")
      .attr("id", "legend")
      // .attr("transform", "translate(" + (width/2 - 230 ) + ", 10)")
      .attr("transform", "translate(230,10)")
      .style("display", showLegend ? "inline" : "none");
  }

  var topics = [];
  activeTopicLabels = [], inactiveTopicLabels = [];

  if (topicLabelsSorted) {
    topicLabelsSorted.forEach(function(k) {
      if (topicLabels[k]["active"]) current = activeTopicLabels;
      else current = inactiveTopicLabels;
      current.push(k);
    });
  }
  var topicLabelsCurrent = activeTopicLabels.concat(inactiveTopicLabels);
  for (i in topicLabelsCurrent) {
    topics.push({'topic': i, 'label': topicLabels[i]['label'], 'active': topicLabels[i]["active"]});
  }
  // legendLabels = vis.select("#legend").selectAll(".legend.label").remove();


  legend = legendGroup.select("#legend").selectAll(".legend.label").data(topics, function (d) { return d.topic;});

  legend.style("fill", legendLabelColor);

  var newLabels = legend.enter().append("svg:g")
      .attr("class", "legend label")
      .attr("transform", legendLabelPositions)
      .style("fill-opacity", function (d) { return (d.active) ? 1.0 : 0.3;})
      .style("fill", legendLabelColor)
      .on("mouseover", highlightTopic)
      .on("mouseout", unhighlightTopic)
      .on("click", toggleTopic)
      .on("contextmenu", displayFullTopic);
  newLabels.append("svg:circle")
      .attr("fill", "inherit")
      .attr("r", 5);
  newLabels.append("svg:text")
      .attr("transform", "translate(10, 0)")
      .attr("fill", "inherit")
      .attr("dy", "0.5em")
      .text(function(d) { return d.label})
      .append("svg:title")
      .text(function(d) { return d.topic;});

  legendGroup.selectAll(".legend.label").transition().duration(500).attr("transform", legendLabelPositions)
      .style("fill-opacity", function (d) { return (d.active) ? 1.0 : 0.3;}); 


  legend.exit().remove();

}

function legendLabelColor(d) {
  return topicLabels[d.topic]["active"] ? graph[0].color(d.topic) : "#666666";
}

function legendLabelPositions (d) {
  var topic = d.topic,
    active = activeTopicLabels.indexOf(topic),
    i;

  if (active != -1) {
    i = active;
  } else {
    i = activeTopicLabels.length + inactiveTopicLabels.indexOf(topic);
  }
  var group = 8;
  return "translate(" + (Math.floor(i/group)*160) + "," + ((i % group)*15) + ")";
}

function legendToggle() {
  showLegend = !showLegend;
  updateLegend();
  var legend = d3.select("#legend");
  legend.style("display", showLegend ? "inline" : "none");
}

function setStartParameters() {
  if (window.location.search != "") {
    var queryString = window.location.search.slice(1);
    var query = queryString.split("&");
    var query_obj = {};
    query.forEach(function (d) {
      var s = d.split("=");
      query_obj[s[0]] = decodeURIComponent(s[1]);
    });
    console.log(query_obj)
    for (i in query_obj) {
      if (i == "topics") {
        var topics = query_obj[i];
        topics = (topics.indexOf(",") != -1) ? topics.split(",") : [topics];

        for (i in topicLabels) {
          topicLabels[i].active = false;
        }
        for (i in topics) {
          topicLabels[topics[i]].active = true;
        }
      }
      else if (i == "legend") { 
        showLegend = query_obj[i] == "none" ? false : true;
        // d3.select("#legend").style("display", query_obj[i]);
      } else if (i == "compare") {
        for (var j = 1; j <= query_obj[i]; j++) { compare();}
      } else if (i == "popup") {
        deferUntilSearchComplete.add(getDocsForYear, query_obj[i]);
      } else if (i == "streaming") {
        streaming = query_obj[i];
      } else if (document.getElementById(i)) {
        document.getElementById(i).value = query_obj[i];
      }
    }
    searchAction();
  }
}

function save() {
  var url = "?";
  url += "&streaming="+(streaming.toString());
  url += "&compare="+(searchN - 1).toString();

  var fields = document.getElementsByTagName("input");
  for (i in fields) {
    if (fields[i].id != undefined) {
      var val = encodeURIComponent(fields[i].value);
      if (val != "") {
        url += "&" + fields[i].id+ "=" + val;
      }
    }
  }
  url += "&topics=" + Object.keys(topicLabels).filter(function (d) { return topicLabels[d].active;}).join(",");
  url += "&legend=" + d3.select("#legend").style("display");
  var popups = d3.selectAll(".popupHolder[display=block]");
  if (!popups.empty()) {
    url += "&popup=" + popups.attr("data-year");  
  }

  console.log(url);
  window.location.href = url;
}

function reset() {
  location.href = window.location.pathname;
}

function compare() {
  generateSearch(searchN++);
}

function nMostTopicsByMetric(n, metric) {
  topicLabelsSorted = Object.keys(topicLabels).sort(metric);
  topicLabelsSorted.forEach(function (d, i) {
    topicLabels[d]["active"] = i < n;
  });
  transition();
}

function mostCoherentTopics(n) {
  nMostTopicsByMetric(n, topicCoherenceSort);
}

function mostCommonTopics(n) {
  nMostTopicsByMetric(n, prevalenceSort);
}

function mostVariantTopics(n) {
  nMostTopicsByMetric(n, stdevSort)
}
function topNCorrelatedTopicPairs(n) {
  var keys = d3.keys(topicCorrelations);
  var values = d3.values(topicCorrelations);
  var key_order = argmax(values, n);
  key_order.reverse();
  var descriptions = [];
  for (i in key_order) {
    var pair = keys[key_order[i]],
      split_pair = pair.split(','),
        a = split_pair[0],
        b = split_pair[1];
    var corr_str = '"' + topicLabels[a]['label'].join(', ') + '" and "' + topicLabels[b]['label'].join(', ') + '": ' + topicCorrelations[pair];
    descriptions.push(corr_str);
  }
  alert(descriptions.join("\n"));
}

function stdevSort(a, b) {
  return d3.max(dataSummed[b].map(function (e) { return e.y; })) - d3.max(dataSummed[a].map(function (e) { return e.y; }));
}
function prevalenceSort(a, b) {
  return topicProportions[b] - topicProportions[a];
}

function topicCoherenceSort(a, b) {
  if (topicCoherence[a] != 0 && topicCoherence[b] != 0) {
    return topicCoherence[b] - topicCoherence[a];
  } else {
    return topicCoherence[a] == 0 ? (topicCoherence[b] == 0 ? 0 : 1) : -1;
  }
}

function argmax(array, n) {
  if (n) {
    return argsort(array).slice(-n);
  } else {
    return array.indexOf(d3.max(array));    
  }
}

function argsort(array) {
  var indices = [];
  for (i in array) { indices.push(i); }
  indices.sort(function (a,b) { return d3.ascending(array[a], array[b]);});
  return indices;
}
function getDocs(d, i, p) {
  var mouse = [d3.event.pageX, d3.event.pageY];
  // var date = d3.time.year.floor(x.invert(mouse[0]));
  var year = x.invert(mouse[0]).getFullYear();

  getDocsForYear(year);
}

function getDocsForYear(year) {
  for (var i in graph) {
    if (graph[i].contributingDocs.hasOwnProperty(year)) {
      var docs = "";
      for (var doc in graph[i].contributingDocs[year]) {
        var id = graph[i].contributingDocs[year][doc];
        var title = docMetadata[id]["title"];
        docs += "<span id='doc" + id + "'>"+ title + "</span><br/>";
      }
      
      d3.select("#popup" + i).html(docs);
      d3.select("#popupHolder" + i).style("display", "block");
      d3.select("#popupHolder" + i).style("left", x(new Date(year, 0, 1)) + "px");      
      d3.select("#popupHolder" + i).style("top", height/2 + "px");
      d3.select("#popupHolder" + i).attr("data-year", year);
    }
  }
}

function createPopup(i) {
  var closeButton = document.createElement("button");
  closeButton.innerText = "x";
  closeButton.onclick = function () {
    d3.selectAll(".popupHolder").style("display", "none");
  };

  var popupHolder = document.createElement("div");
  popupHolder.id = "popupHolder" + i;
  popupHolder.className = "popupHolder";

  var popup = document.createElement("div");
  popup.id = "popup" + i;
  popup.className = "popup";

  popupHolder.appendChild(closeButton)
  popupHolder.appendChild(popup);
  return popupHolder;
}

function generateSearch(i) {
  var form = document.createElement("form");
  form.id = "searchForm" + i;
  form.action = "javascript:void(0);";

  if (i == 0) {
    var searchTimeLabel = document.createElement("label");
    searchTimeLabel.textContent = "Time:";

    var searchTime = document.createElement("input");
    searchTime.type = "text";
    searchTime.id="searchTime" + i;
    searchTime.alt="time";
    searchTime.onchange = searchAction;

    searchTimeLabel.appendChild(searchTime);
    form.appendChild(searchTimeLabel);
  }

  var searchLabel = document.createElement("label");
  searchLabel.textContent = "Search " + (i + 1);

  var search = document.createElement("input");
  search.type = "text";
  search.id="search" + i;
  search.alt="enter to search";
  search.onchange = searchAction;

  searchLabel.appendChild(search);
  form.appendChild(searchLabel);

  document.getElementById("searches").appendChild(form);

  var popup = createPopup(i);
  document.getElementById("popupLayer").appendChild(popup);
  createGraphObject(i);
}

function createGraphObject(i) {
  graph[i] = {'searchFilter': function() { return true; }, 
    'data': null, 
    'defaultOpacity': 1.0 - (i/5.0), 
    'graphCreated': false,
    'results': null,
    'dasharray': i == 0 ? "" : 12 / (i+1),
    'contributingDocs': {},
    'baseline': 0
  };
    graph[i]['color'] = d3.scale.category20().domain(d3.range(20)); //ordinal().range(colorbrewer.Spectral[9]).domain(d3.range(20));
}
function highlightItem(itemID) {
  getDocsForYear(docMetadata[itemID]["year"]);
  d3.select("#doc" + itemID.toString()).call(flash);
}

function flash(selection) {
    selection.transition().duration(2000)
      .ease("linear")
      .styleTween("fill-opacity", function (d, i, a) {
        return function (t) { 
          var x = (Math.sin(t * Math.PI * 4)) + 1;
          return x.toString(); 
        }
      });
}
function searchAction() {
  var queryTime = document.getElementById("searchTime0").value;
  if (queryTime == "") {
    timeFilter = function() { return true; }
    startDate = origTopicTimeData[0][0].x;
    endDate = origTopicTimeData[0][origTopicTimeData[0].length - 1].x;
  }
  else {
    var times = queryTime.split("-");
    startDate = dateParse(times[0]);
    endDate = dateParse(times[1]);
    timeFilter = function(d) {
      return d.x >= startDate && d.x <= endDate;
    };
  }

  for (var i in graph) {
    graph[i].queryStr = document.getElementById("search" + i).value;
  }

  for (var i = 0; i < searchN; i++ ) {
    if (graph[i].queryStr == "" && i != 0) {
      graph[i].searchFilter = function() { return false;};
    } else {
        if (graph[i].queryStr == "") {
          graph[i].searchFilter = function() { 
            return true; 
          };
        } else {
            var me = graph[i];

            var element = document.createElement("PaperMachinesDataElement");
            element.setAttribute("query", graph[i].queryStr);
            document.documentElement.appendChild(element);

            me.searchCallback = function (search) {
              me.results = search;
              me.searchFilter = function (d) {
                  return me.results.indexOf(parseInt(d.itemID)) != -1;
              };
            };

            document.addEventListener("papermachines-response", function(event) {
                var node = event.target, response = node.getUserData("response");
                document.documentElement.removeChild(node);
                document.removeEventListener("papermachines-response", arguments.callee, false);
                me.searchCallback(JSON.parse(response));
              }, false);

            var evt = document.createEvent("HTMLEvents");
            evt.initEvent("papermachines-request", true, false);
            element.dispatchEvent(evt);

          }
      } 
  }
  setTimeout(function () {transition();}, 500);
  deferUntilSearchComplete.next();
}

function createGradientScale() {
  var my_range = d3.range(0, 2.2, 0.2);

  var gradientAxis = d3.svg.axis()
    .scale(d3.scale.linear().domain([0, 2]).range([0,200]))
    .ticks(2)
    .tickFormat(d3.format("d"))
    .tickSize(0);

  defs.selectAll("#gradientScaleGradient").data([my_range]).enter().append("svg:linearGradient")
    .attr("id", "gradientScaleGradient")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "100%")
    .attr("y2", "0%")
    .selectAll("stop").data(function (d) { return d; })
      .enter().append("svg:stop")
      .attr("offset", function (d) { return (d * 100.0 / 2) + "%"; })
      .attr("stop-color", "#000")
      .attr("stop-opacity", function (d) { return gradientOpacity(d); });

  var gradientBox = d3.select("svg").append("svg:g")
    .attr("id", "gradientScale")
    .attr("width", "200")
    .attr("height", "30")
   .attr("transform", "translate(" + ((width/2) - 100) + "," + (height - 100) + ")");
  gradientBox.append("svg:text")
    .attr("x", "100")
    .attr("y", "-16")
    .style("fill", "#000")
    .attr("text-anchor", "middle")
    .text("std deviations from mean");

  gradientBox.append("svg:rect")
      .attr("width", "200")
      .attr("height", "20")
      .style("stroke", "#666")
      .style("fill", "url(#gradientScaleGradient)");

  gradientBox.append("svg:g")
    .style("fill", "#000")
    .style("stroke", "none")
    .attr("transform", "translate(0,20)")
    .call(gradientAxis);

}
function updateGradients(i) {
  defs.selectAll("linearGradient.graph" + i.toString()).remove();
  var gradients = defs.selectAll("linearGradient.graph" + i.toString()).data(graph[i].data, function(d) { return d[0].topic; });
  gradients.enter().append("svg:linearGradient")
      .attr("id", function (d) { return "linearGradientTopic" + d[0].topic.toString();})
      .attr("class", "graph" + i.toString())
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "100%")
      .attr("y2", "0%")
      .call(addStops);
}

function addStops(selection) {
  var stops = selection.selectAll("stop").data(function (d) { return d; });
  stops.enter().append("svg:stop")
      .attr("offset", function (d, i) { return (i * 100.0 / this.parentNode.__data__.length) + "%"; })
      .attr("stop-color", function (d) { return graph[0].color(d.topic);})
      .attr("stop-opacity", function (d) { return gradientOpacity(Math.abs(d.y)); });
}

function topicCloud(i, parent) {
  var topicWords = topicLabels[i]["fulltopic"]
      cloudW = 300,
      cloudH = 150,
      cloudFontSize = d3.scale.log().domain(d3.extent(topicWords.map(function (d) { return +d.prob; }))).range([8,32]),
      cloud = d3.layout.cloud()
        .size([cloudW, cloudH])
        .padding(5)
        .words(topicWords)
        .rotate(0)
        .fontSize(function(d) { return cloudFontSize(d.prob); })
        .on("end", draw)
        .start();

  function draw(words) {
    if (parent.empty()) {
      parent = d3.select("body").append("svg")
        .attr("width", cloudW)
        .attr("height", cloudH);
    }
    parent.append("g")
        .attr("class", "cloud" + i.toString())
        .attr("transform", "translate(" + cloudW/2 + "," + cloudH / 2 + ")")
      .selectAll("text")
        .data(words)
      .enter().append("text")
        .style("font-size", function(d) { return d.size + "px"; })
        .style("fill", graph[0].color(i))
        .attr("text-anchor", "middle")
        .attr("transform", function(d) {
          return "translate(" + [d.x, d.y] + ")rotate(" + d.rotate + ")";
        })
        .text(function(d) { return d.text; });
  }

  return parent.select("g.cloud" + i.toString());
}

function saveSVG() {
  var xml = "<svg xmlns='http://www.w3.org/2000/svg'><style>";
    for (i in document.styleSheets)
          for (j in document.styleSheets[i].cssRules)
            if (typeof(document.styleSheets[i].cssRules[j].cssText) != "undefined")
              xml += document.styleSheets[i].cssRules[j].cssText;

    xml += "</style>";  
    xml += d3.select("svg")[0][0].innerHTML;
    xml += "</svg>";
    window.location.href = "data:application/svg+xml," + encodeURIComponent(xml);
}