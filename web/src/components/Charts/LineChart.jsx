import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import useThemeStore from '../../stores/useThemeStore';

const LineChart = ({ height = 260 }) => {
  const containerRef = useRef(null);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    if (!containerRef.current) return;
    const myChart = echarts.init(containerRef.current, mode === 'dark' ? 'dark' : undefined);

    const option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 10, top: 20, bottom: 30, containLabel: true },
      xAxis: [
        {
          type: 'category',
          axisTick: { show: false },
          data: ['2012', '2013', '2014', '2015', '2016'],
          axisLabel: { fontSize: 10 },
        },
      ],
      yAxis: [{ type: 'value', axisLabel: { fontSize: 10 } }],
      series: [
        { name: 'Forest', type: 'bar', data: [320, 332, 301, 334, 390] },
        { name: 'Steppe', type: 'bar', data: [220, 182, 191, 234, 290] },
        { name: 'Desert', type: 'bar', data: [150, 232, 201, 154, 190] },
        { name: 'Wetland', type: 'bar', data: [98, 77, 101, 99, 40] },
      ],
    };

    myChart.setOption(option);
    const resize = () => myChart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      myChart.dispose();
    };
  }, [mode]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
};

export default LineChart;
