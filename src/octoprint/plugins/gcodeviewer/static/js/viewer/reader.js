/**
 * User: hudbrog (hudbrog@gmail.com)
 * Date: 10/21/12
 * Time: 7:31 AM
 */

GCODE.gCodeReader = (function () {
    // ***** PRIVATE ******
    var gcode, lines;
    var z_heights = {};
    var model = [];
    var max = {x: undefined, y: undefined, z: undefined};
    var min = {x: undefined, y: undefined, z: undefined};
    var modelSize = {x: undefined, y: undefined, z: undefined};
    var boundingBox = {
        minX: undefined,
        maxX: undefined,
        minY: undefined,
        maxY: undefined,
        minZ: undefined,
        maxZ: undefined
    };
    var filamentByLayer = {};
    var printTimeByLayer;
    var totalFilament = 0;
    var printTime = 0;
    var speeds = {};
    var speedsByLayer = {};
    var gCodeOptions = {
        sortLayers: false,
        purgeEmptyLayers: true,
        analyzeModel: false,
        toolOffsets: [{x: 0, y: 0}],
        bed: {
            x: undefined,
            y: undefined,
            r: undefined,
            circular: undefined,
            centeredOrigin: undefined
        },
        ignoreOutsideBed: false,
        g90InfluencesExtruder: false,
        bedZ: 0
    };

    var percentageTree = undefined;

    var prepareGCode = function (totalSize) {
        if (!lines) return;
        gcode = [];
        var i, byteCount;

        byteCount = 0;
        for (i = 0; i < lines.length; i++) {
            byteCount += lines[i].length + 1; // line length + line ending
            gcode.push({line: lines[i], percentage: (byteCount * 100) / totalSize});
        }
        lines = [];
    };

    var sortLayers = function (m) {
        var sortedZ = [];
        var tmpModel = [];

        for (var layer in z_heights) {
            sortedZ[z_heights[layer]] = layer;
        }

        sortedZ.sort(function (a, b) {
            return a - b;
        });

        for (var i = 0; i < sortedZ.length; i++) {
            if (typeof z_heights[sortedZ[i]] === "undefined") continue;
            tmpModel[i] = m[z_heights[sortedZ[i]]];
        }
        return tmpModel;
    };

    var prepareLinesIndex = function (m) {
        percentageTree = undefined;

        for (var l = 0; l < m.length; l++) {
            if (m[l] === undefined) continue;
            for (var i = 0; i < m[l].length; i++) {
                var percentage = m[l][i].percentage;
                var value = {layer: l, cmd: i};
                if (!percentageTree) {
                    percentageTree = new AVLTree({key: percentage, value: value}, "key");
                } else {
                    percentageTree.add({key: percentage, value: value});
                }
            }
        }
    };

    var searchInPercentageTree = function (key) {
        if (percentageTree === undefined) {
            return undefined;
        }

        var elements = percentageTree.findBest(key);
        if (elements.length === 0) {
            return undefined;
        }

        return elements[0];
    };

    var purgeLayers = function (m) {
        if (!m) return;
        var tmpModel = [];

        var purge;
        for (var i = 0; i < m.length; i++) {
            purge = true;

            if (typeof m[i] !== "undefined") {
                for (var j = 0; j < m[i].length; j++) {
                    if (m[i][j].extrude) {
                        purge = false;
                        break;
                    }
                }
            }

            if (!purge) {
                tmpModel.push(m[i]);
            }
        }

        return tmpModel;
    };

    // ***** PUBLIC *******
    return {
        clear: function () {
            model = [];
            z_heights = [];
            max = {x: undefined, y: undefined, z: undefined};
            min = {x: undefined, y: undefined, z: undefined};
            modelSize = {x: undefined, y: undefined, z: undefined};
            boundingBox = {
                minX: undefined,
                maxX: undefined,
                minY: undefined,
                maxY: undefined,
                minZ: undefined,
                maxZ: undefined
            };
        },

        loadFile: function (reader) {
            this.clear();

            var totalSize = reader.target.result.length;
            lines = reader.target.result.split(/[\r\n]/g);
            reader.target.result = null;
            prepareGCode(totalSize);

            GCODE.ui.worker.postMessage({
                cmd: "parseGCode",
                msg: {
                    gcode: gcode,
                    options: {
                        firstReport: 5,
                        toolOffsets: gCodeOptions["toolOffsets"],
                        bed: gCodeOptions["bed"],
                        ignoreOutsideBed: gCodeOptions["ignoreOutsideBed"],
                        g90InfluencesExtruder: gCodeOptions["g90InfluencesExtruder"],
                        bedZ: gCodeOptions["bedZ"]
                    }
                }
            });
        },

        setOption: function (options) {
            var dirty = false;
            _.forOwn(options, function (value, key) {
                if (value === undefined) return;
                dirty = dirty || gCodeOptions[key] !== value;
                gCodeOptions[key] = value;
            });
            if (dirty) {
                if (model && model.length > 0) this.passDataToRenderer();
            }
        },

        passDataToRenderer: function () {
            var m = model;
            if (gCodeOptions["sortLayers"]) m = sortLayers(m);
            if (gCodeOptions["purgeEmptyLayers"]) m = purgeLayers(m);
            prepareLinesIndex(m);
            GCODE.renderer.doRender(m, 0);
            return m;
        },

        processLayerFromWorker: function (msg) {
            model[msg.layerNum] = msg.cmds;
            z_heights[msg.zHeightObject.zValue] = msg.zHeightObject.layer;
        },

        processMultiLayerFromWorker: function (msg) {
            for (var i = 0; i < msg.layerNum.length; i++) {
                model[msg.layerNum[i]] = msg.model[msg.layerNum[i]];
                z_heights[msg.zHeightObject.zValue[i]] = msg.layerNum[i];
            }
        },

        processAnalyzeModelDone: function (msg) {
            min = msg.min;
            max = msg.max;
            modelSize = msg.modelSize;
            boundingBox = msg.boundingBox;
            totalFilament = msg.totalFilament;
            filamentByLayer = msg.filamentByLayer;
            speeds = msg.speeds;
            speedsByLayer = msg.speedsByLayer;
            printTime = msg.printTime;
            printTimeByLayer = msg.printTimeByLayer;
        },

        getLayerFilament: function (z) {
            return filamentByLayer[z];
        },

        getLayerSpeeds: function (z) {
            return speedsByLayer[z] ? speedsByLayer[z] : {};
        },

        getModelInfo: function () {
            return {
                min: min,
                max: max,
                modelSize: modelSize,
                boundingBox: boundingBox,
                totalFilament: totalFilament,
                speeds: speeds,
                speedsByLayer: speedsByLayer,
                printTime: printTime,
                printTimeByLayer: printTimeByLayer
            };
        },

        getGCodeLines: function (layer, fromSegments, toSegments) {
            var result = {
                first: model[layer][fromSegments].gcodeLine,
                last: model[layer][toSegments].gcodeLine
            };
            return result;
        },

        getCmdIndexForPercentage: function (percentage) {
            var command = searchInPercentageTree(percentage);
            if (command === undefined) {
                return undefined;
            } else {
                return command.value;
            }
        }
    };
})();
