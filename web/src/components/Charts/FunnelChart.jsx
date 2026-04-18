import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import useThemeStore from '../../stores/useThemeStore';

const FunnelChart = ({ height = 260 }) => {
  const containerRef = useRef(null);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    if (!containerRef.current) return;
    const myChart = echarts.init(containerRef.current, mode === 'dark' ? 'dark' : undefined);

    const option = {
      tooltip: { trigger: 'item', formatter: '{a} <br/>{b} : {c}%' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [
        {
          name: 'Expected',
          type: 'funnel',
          left: '10%',
          top: 10,
          bottom: 30,
          width: '80%',
          label: { fontSize: 10, formatter: '{b}' },
          labelLine: { show: false },
          itemStyle: { opacity: 0.7 },
          data: [
            { value: 60, name: 'Visit' },
            { value: 40, name: 'Inquiry' },
            { value: 20, name: 'Order' },
            { value: 80, name: 'Click' },
            { value: 100, name: 'Show' },
          ],
        },
        {
          name: 'Actual',
          type: 'funnel',
          left: '10%',
          top: 10,
          bottom: 30,
          width: '80%',
          maxSize: '80%',
          label: { position: 'inside', formatter: '{c}%', color: '#fff', fontSize: 10 },
          itemStyle: { opacity: 0.5, borderColor: '#fff', borderWidth: 2 },
          data: [
            { value: 30, name: 'Visit' },
            { value: 10, name: 'Inquiry' },
            { value: 5, name: 'Order' },
            { value: 50, name: 'Click' },
            { value: 80, name: 'Show' },
          ],
          z: 100,
        },
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

export default FunnelChart;
