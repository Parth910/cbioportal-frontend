import * as React from "react";
import {Observer, observer} from "mobx-react";
import {IStringAxisData} from "../../../pages/resultsView/plots/PlotsTabUtils";
import {computed, observable} from "mobx";
import {bind} from "bind-decorator";
import CBIOPORTAL_VICTORY_THEME, {axisTickLabelStyles, baseLabelStyles} from "../../theme/cBioPoralTheme";
import {getTextWidth} from "../../lib/wrapText";
import autobind from "autobind-decorator";
import _ from "lodash";
import {VictoryAxis, VictoryBar, VictoryChart, VictoryLabel, VictoryStack, VictoryLegend, VictoryGroup} from "victory";
import Timer = NodeJS.Timer;
import {tickFormatNumeral} from "./TickUtils";
import {makeUniqueColorGetter} from "./PlotUtils";
import {stringListToIndexSet} from "../../lib/StringUtils";
import ScatterPlotTooltip from "./ScatterPlotTooltip";
import { makePlotData, makeBarSpecs, sortDataByCategory } from "./MultipleCategoryBarPlotUtils";

export interface IMultipleCategoryBarPlotProps {
    svgId?:string;
    domainPadding?:number;
    horzData:IStringAxisData["data"];
    vertData:IStringAxisData["data"];
    categoryToColor?:{[cat:string]:string};
    barWidth:number;
    chartBase:number;
    horizontalBars?:boolean;
    horzCategoryOrder?:string[];
    vertCategoryOrder?:string[];
    axisLabelX?: string;
    axisLabelY?: string;
    legendLocationWidthThreshold?: number;
    percentage?:boolean;
    stacked?:boolean;
}

export interface IMultipleCategoryBarPlotData {
    minorCategory:string, 
    counts:{majorCategory:string, count:number, percentage:number}[]
}

const RIGHT_GUTTER = 120; // room for legend
const NUM_AXIS_TICKS = 8;
const PLOT_DATA_PADDING_PIXELS = 100;
const CATEGORY_LABEL_HORZ_ANGLE = 50;
const DEFAULT_LEFT_PADDING = 25;
const DEFAULT_BOTTOM_PADDING = 10;
const LEGEND_ITEMS_PER_ROW = 4;
const BOTTOM_LEGEND_PADDING = 15;
const RIGHT_PADDING_FOR_LONG_LABELS = 50;
const COUNT_AXIS_LABEL = "# samples";

@observer
export default class MultipleCategoryBarPlot extends React.Component<IMultipleCategoryBarPlotProps, {}> {
    @observable.ref tooltipModel:any|null = null;
    @observable pointHovered:boolean = false;
    private mouseEvents:any = this.makeMouseEvents();
    private legendClassName:string = `stacked-bar-plot-legend-${Math.random()}`;
    @observable computedLegendWidth = 0;

    @observable.ref private container:HTMLDivElement;

    @bind
    private containerRef(container:HTMLDivElement) {
        this.container = container;
        this.updateLegendWidth();
    }

    @computed get getColor() {
        const uniqueColorGetter = makeUniqueColorGetter(_.values(this.props.categoryToColor));
        const categoryToColor:{[category:string]:string} = {};
        _.forEach(this.props.categoryToColor, (color, category)=>{
            categoryToColor[category.toLowerCase()] = color;
        });
        return function(category:string) {
            category = category.toLowerCase();
            if (!(category in categoryToColor)) {
                categoryToColor[category] = uniqueColorGetter();
            }
            return categoryToColor[category];
        };
    }

    private makeMouseEvents() {
        let disappearTimeout:Timer | null = null;
        const disappearDelayMs = 250;

        return [{
            target: "data",
            eventHandlers: {
                onMouseOver: () => {
                    return [
                        {
                            target: "data",
                            mutation: (props: any) => {
                                this.tooltipModel = props;
                                this.pointHovered = true;

                                if (disappearTimeout !== null) {
                                    clearTimeout(disappearTimeout);
                                    disappearTimeout = null;
                                }

                                return { active: true };
                            }
                        }
                    ];
                },
                onMouseOut: () => {
                    return [
                        {
                            target: "data",
                            mutation: () => {
                                if (disappearTimeout !== null) {
                                    clearTimeout(disappearTimeout);
                                }

                                disappearTimeout = setTimeout(()=>{
                                    this.pointHovered = false;
                                }, disappearDelayMs);

                                return { active: false };
                            }
                        }
                    ];
                }
            }
        }];
    }

    @computed get chartWidth() {
        let specifiedWidth:number;
        if (this.props.horizontalBars) {
            specifiedWidth = this.props.chartBase;
        } else {
            specifiedWidth = this.chartExtent;
        }

        return Math.max(
            specifiedWidth,
            getTextWidth(this.props.axisLabelX || "", baseLabelStyles.fontFamily, baseLabelStyles.fontSize+"px")
        ); // make sure theres enough room for the x-axis label
    }

    @computed get chartHeight() {
        let specifiedWidth:number;
        if (this.props.horizontalBars) {
            specifiedWidth = this.chartExtent;
        } else {
            specifiedWidth = this.props.chartBase;
        }

        return Math.max(
            specifiedWidth,
            getTextWidth(this.props.axisLabelY || "", baseLabelStyles.fontFamily, baseLabelStyles.fontSize+"px")
        ); // make sure theres enough room for the y-axis label
    }

    @computed get sideLegendX() {
        return this.chartWidth - 20;
    }

    @computed get legendLocation() {
        if ((this.props.legendLocationWidthThreshold !== undefined &&
            this.chartWidth > this.props.legendLocationWidthThreshold) // move to bottom if chart width is too large, leaving no room for legend on the side
            || (this.legendData.length > 15) // move to bottom if legend is too long, making it run off the screen
        ) {
            return "bottom";
        } else {
            return "right";
        }
    }

    @computed get bottomLegendHeight() {
        //height of legend in case its on bottom
        if (this.legendData.length === 0) {
            return 0;
        } else {
            const numRows = Math.ceil(this.legendData.length / LEGEND_ITEMS_PER_ROW);
            return 23.7*numRows;
        }
    }

    @computed get legendData() {
        return sortDataByCategory(
            this.data, d=>d.minorCategory, this.minorCategoryOrder
        ).map(obj=>({
            name: obj.minorCategory,
            symbol:{
                type: "square",
                fill: this.getColor(obj.minorCategory),
                strokeOpacity: 0,
                size: 5
            }
        }));
    }

    private get legend() {
        if (this.legendData.length > 0) {
            return (
                <VictoryLegend
                    orientation={this.legendLocation === "right" ? "vertical" : "horizontal"}
                    itemsPerRow={this.legendLocation === "right" ? undefined : LEGEND_ITEMS_PER_ROW}
                    rowGutter={this.legendLocation === "right" ? undefined : -5}
                    data={this.legendData}
                    x={this.legendLocation === "right" ? this.sideLegendX : 0}
                    y={this.legendLocation === "right" ? 100 : this.svgHeight-this.bottomLegendHeight}
                    groupComponent={<g className={this.legendClassName}/>}
                />
            );
        } else {
            return null;
        }
    }

    @computed get data():IMultipleCategoryBarPlotData[] {
        return makePlotData(this.props.horzData, this.props.vertData, !!this.props.horizontalBars);
    }

    @computed get maxMajorCount() {
        if(this.props.percentage){
            return 100;
        }
        const majorCategoryCounts:{[major:string]:number} = {};
        for (const d of this.data) {
            for (const c of d.counts) {
                majorCategoryCounts[c.majorCategory] = majorCategoryCounts[c.majorCategory] || 0;
                if (this.props.stacked) {
                    majorCategoryCounts[c.majorCategory] += c.count;
                } else {
                    majorCategoryCounts[c.majorCategory] = Math.max(c.count, majorCategoryCounts[c.majorCategory]);
                }
            }
        }
        return _.chain(majorCategoryCounts).values().max().value() as number;
    }

    @computed get plotDomain() {
        // data domain is 0 to max num samples
        let x:number[], y:number[];
        const countDomain:number[] = [0, this.maxMajorCount];
        let categoryDomain:number[];
        if (this.data.length > 0) {
            categoryDomain = [this.categoryCoord(0), this.categoryCoord(Math.max(1, this.data[0].counts.length - 1))];
        } else {
            categoryDomain = [0,0];
        }
        if (this.props.horizontalBars) {
            x = countDomain;
            y = categoryDomain;
        } else {
            x = categoryDomain;
            y = countDomain;
        }
        return { x, y };
    }

    @computed get offset() {
        return this.barWidth;
    }

    @computed get categoryAxisDomainPadding() {
        return this.domainPadding;
    }

    @computed get countAxisDomainPadding() {
        return this.domainPadding;
    }

    @computed get domainPadding() {
        if (this.props.domainPadding === undefined) {
            return PLOT_DATA_PADDING_PIXELS;
        } else {
            return this.props.domainPadding;
        }
    }

    @computed get countAxis():"x"|"y" {
        if (this.props.horizontalBars) {
            return "x";
        } else {
            return "y";
        }
    }

    @computed get categoryAxis():"x"|"y" {
        if (this.props.horizontalBars) {
            return "y";
        } else {
            return "x";
        }
    }

    @computed get chartDomainPadding() {
        return {
            [this.countAxis]:this.countAxisDomainPadding,
            [this.categoryAxis]:this.categoryAxisDomainPadding+this.additionalPadding
        };
    }

    @computed get additionalPadding() {
        //if not stacked add padding to move the bars right
        return this.props.stacked ? 0 : this.categoryCoord(this.data.length / 2);
    }

    @computed get chartExtent() {
        let miscPadding = 100; // specifying chart width in victory doesnt translate directly to the actual graph size
        if (this.data.length > 0) {
            let numBars = 0;
            if (this.props.stacked) {
                numBars = this.data[0].counts.length;
            } else {
                numBars = _.sumBy(this.data, categoryPlotData => categoryPlotData.counts.length);
            }
            return this.categoryCoord(numBars - 1) + 2 * (this.categoryAxisDomainPadding) + miscPadding + this.additionalPadding;
        } else {
            return miscPadding;
        }
    }

    @computed get svgWidth() {
        return this.leftPadding + this.chartWidth + this.rightPadding;
    }

    @computed get svgHeight() {
        return this.topPadding + this.chartHeight + this.bottomPadding;
    }

    @computed get barSeparation() {
        return 0.2*this.barWidth;
    }

    @computed get barWidth() {
        return this.props.barWidth || 10;
    }

    @computed get labels() {
        if (this.data.length > 0) {
            return sortDataByCategory(
                this.data[0].counts.map(c=>c.majorCategory), x=>x, this.majorCategoryOrder
            );
        } else {
            return [];
        }
    }

    @bind
    private formatCategoryTick(t:number, index:number) {
        //return wrapTick(this.labels[index], MAXIMUM_CATEGORY_LABEL_SIZE);
        return this.labels[index];
    }

    @bind
    private formatNumericalTick(t:number, i:number, ticks:number[]) {
        return tickFormatNumeral(t, ticks);
    }

    @computed get zeroCountOffset() {
        //add a small offset when its not a stacked bar to show empty bar
        return this.props.stacked ? 0 : (0.03 * (this.maxMajorCount / NUM_AXIS_TICKS));
    }

    @computed get horzAxis() {
        // several props below are undefined in horizontal mode, thats because in horizontal mode
        //  this axis is for numbers, not categories
        const label = [this.props.axisLabelX];
        if (this.props.horizontalBars) {
            label.unshift(`${COUNT_AXIS_LABEL}${this.props.percentage ? " (%)": ""}`);
        }
        return (
            <VictoryAxis
                orientation="bottom"
                offsetY={50 + (this.props.horizontalBars ? 0 : this.zeroCountOffset)}
                crossAxis={false}
                label={label}

                tickValues={this.props.horizontalBars ? undefined: this.categoryTickValues}
                tickCount={this.props.horizontalBars ? NUM_AXIS_TICKS: undefined }
                tickFormat={this.props.horizontalBars ? this.formatNumericalTick : this.formatCategoryTick}
                tickLabelComponent={<VictoryLabel angle={this.props.horizontalBars ? undefined : CATEGORY_LABEL_HORZ_ANGLE}
                                                  verticalAnchor={this.props.horizontalBars ? undefined : "start"}
                                                  textAnchor={this.props.horizontalBars ? undefined : "start"}
                />}
                axisLabelComponent={<VictoryLabel dy={this.props.horizontalBars ? 35 : this.biggestCategoryLabelSize + 24}/>}
            />
        );
    }

    @computed get vertAxis() {
        const label = [this.props.axisLabelY];
        if (!this.props.horizontalBars) {
            label.push(`${COUNT_AXIS_LABEL}${this.props.percentage ? " (%)": ""}`);
        }
        return (
            <VictoryAxis
                orientation="left"
                offsetX={50 + (this.props.horizontalBars ? this.zeroCountOffset : 0)}
                crossAxis={false}
                label={label}
                dependentAxis={true}
                tickValues={this.props.horizontalBars ? this.categoryTickValues : undefined}
                tickCount={this.props.horizontalBars ? undefined : NUM_AXIS_TICKS}
                tickFormat={this.props.horizontalBars ? this.formatCategoryTick : this.formatNumericalTick}
                axisLabelComponent={<VictoryLabel dy={this.props.horizontalBars ? -1*this.biggestCategoryLabelSize - 24 : -40}/>}
            />
        );
    }

    @computed get leftPadding() {
        // more left padding if horizontal, to make room for labels
        if (this.props.horizontalBars) {
            return this.biggestCategoryLabelSize;
        } else {
            return DEFAULT_LEFT_PADDING;
        }
    }

    @computed get topPadding() {
        return 0;
    }

    @computed get rightPadding() {
        if (this.legendData.length > 0 && this.legendLocation === "right") {
            // make room for legend
            return this.biggestLegendLabelWidth + 20;
        } else {
            // make room for legend at bottom
            return Math.max(RIGHT_PADDING_FOR_LONG_LABELS, this.computedLegendWidth - this.chartWidth);
        }
    }

    @computed get bottomPadding() {
        let paddingForLabels = DEFAULT_BOTTOM_PADDING;
        let paddingForLegend = 0;

        if (!this.props.horizontalBars) {
            // more padding if vertical, because category labels extend to bottom
            paddingForLabels = this.biggestCategoryLabelSize;
        }
        if (this.legendLocation === "bottom") {
            // more padding if legend location is "bottom", to make room for legend
            paddingForLegend = this.bottomLegendHeight + BOTTOM_LEGEND_PADDING;
        }

        return paddingForLabels + paddingForLegend;
    }

    @computed get biggestLegendLabelWidth() {
        return Math.max(
            ...this.legendData.map(x=>getTextWidth(x.name, baseLabelStyles.fontFamily, baseLabelStyles.fontSize+"px"))
        );
    }

    @computed get biggestCategoryLabelSize() {
        const maxSize = Math.max(
            ...this.labels.map(x=>getTextWidth(x, axisTickLabelStyles.fontFamily, axisTickLabelStyles.fontSize+"px"))
        );
        if (this.props.horizontalBars) {
            // if horizontal mode, its label width
            return maxSize;
        } else {
            // if vertical mode, its label height when rotated
            return maxSize*Math.abs(Math.sin((Math.PI/180) * CATEGORY_LABEL_HORZ_ANGLE));
        }
    }

    @computed get minorCategoryOrder() {
        let order;
        if (this.props.horizontalBars) {
            order = this.props.horzCategoryOrder;
        } else {
            order = this.props.vertCategoryOrder;
        }
        if (order) {
            return stringListToIndexSet(order);
        } else {
            return undefined;
        }
    }

    @computed get majorCategoryOrder() {
        let order;
        if (this.props.horizontalBars) {
            order = this.props.vertCategoryOrder;
        } else {
            order = this.props.horzCategoryOrder;
        }
        if (order) {
            return stringListToIndexSet(order);
        } else {
            return undefined;
        }
    }
    
    @autobind
    private categoryCoord(index:number) {
        return index * (this.barWidth + this.barSeparation); // half box + separation + half box
    }

    @computed get categoryTickValues() {
        if (this.data.length > 0 ) {
            return this.data[0].counts.map((x, i)=>this.categoryCoord(i));
        } else {
            return [];
        }
    }

    private get bars() {
        const barSpecs = makeBarSpecs(
            this.data,
            this.minorCategoryOrder,
            this.majorCategoryOrder,
            this.getColor,
            this.categoryCoord,
            !!this.props.horizontalBars,
            !!this.props.percentage
        )
        return barSpecs.map(spec=>(
            <VictoryBar
                style={{ data: { fill: spec.fill, width:this.barWidth } }}
                data={
                    _.map(spec.data, datum => ({
                        ...datum,
                        y: datum.y + this.zeroCountOffset
                    }))
                }
                events={this.mouseEvents}
            />
        ));
    }

    private tooltip(datum:any) {
        return (
            <div>
                <strong>{datum.majorCategory}</strong><br/>
                <strong>{datum.minorCategory}</strong>:&nbsp;{datum.count}&nbsp;sample{datum.count === 1 ? "" : "s"}&nbsp;({datum.percentage}%)
            </div>
        );
    }

    @computed get chartEtl() {
        if (this.props.stacked) {
            return (<VictoryStack horizontal={this.props.horizontalBars}>
                {this.bars}
            </VictoryStack>)
        }
        return (<VictoryGroup offset={this.offset} horizontal={this.props.horizontalBars}>
            {this.bars}
        </VictoryGroup>)
    }

    @autobind
    private getChart() {
        if (this.data.length > 0) {
            return (
                <div
                    ref={this.containerRef}
                    style={{width: this.svgWidth, height: this.svgHeight}}
                >
                    <svg
                        id={this.props.svgId || ""}
                        style={{
                            width: this.svgWidth,
                            height: this.svgHeight,
                            pointerEvents: "all"
                        }}
                        height={this.svgHeight}
                        width={this.svgWidth}
                        role="img"
                        viewBox={`0 0 ${this.svgWidth} ${this.svgHeight}`}
                    >
                        <g
                            transform={`translate(${this.leftPadding}, ${this.topPadding})`}
                        >
                            <VictoryChart
                                theme={CBIOPORTAL_VICTORY_THEME}
                                width={this.chartWidth}
                                height={this.chartHeight}
                                standalone={false}
                                domainPadding={this.chartDomainPadding}
                                domain={this.plotDomain}
                                singleQuadrantDomainPadding={{
                                    [this.countAxis]:true,
                                    [this.categoryAxis]:false
                                }}
                            >
                                {this.legend}
                                {this.horzAxis}
                                {this.vertAxis}
                                {this.chartEtl}
                            </VictoryChart>
                        </g>
                    </svg>
                </div>
            );
        } else {
            return <span>No data to plot.</span>
        }
    }

    @autobind
    private getTooltip() {
        if (this.container && this.tooltipModel) {
            const countAxisOffset = (this.tooltipModel.y + this.tooltipModel.y0)/2;
            const categoryAxisOffset = this.tooltipModel.x;
            return (
                <ScatterPlotTooltip
                    placement={this.props.horizontalBars ? "bottom" : "right"}
                    container={this.container}
                    targetHovered={this.pointHovered}
                    targetCoords={{
                        x: (this.categoryAxis === "x" ? categoryAxisOffset : countAxisOffset) + this.leftPadding,
                        y: (this.categoryAxis === "y" ? categoryAxisOffset : countAxisOffset) + this.topPadding
                    }}
                    overlay={this.tooltip(this.tooltipModel.datum)}
                    arrowOffsetTop={20}
                />
            );
        } else {
            return <span></span>;
        }
    }

    private updateLegendWidth() {
        if(this.container) {
            const legend = this.container.getElementsByClassName(this.legendClassName).item(0);
            if (legend) {
                this.computedLegendWidth = legend.getBoundingClientRect().width;
            }
        }
    }

    componentDidUpdate(){
        this.updateLegendWidth();
    }

    render() {
        if (!this.data.length) {
            return <div className={'alert alert-info'}>No data to plot.</div>;
        }
        return (
            <div>
                <Observer>
                    {this.getChart}
                </Observer>
                <Observer>
                    {this.getTooltip}
                </Observer>
            </div>
        );
    }
}