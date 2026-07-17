from setuptools import setup

package_name = "mycobot_driver"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (f"share/{package_name}/launch", ["launch/simulated_driver.launch.py"]),
        (f"share/{package_name}/config", ["config/defaults.yaml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="robot-learning",
    maintainer_email="user@example.com",
    description="Starter ROS 2 interfaces for myCobot 280 M5 learning.",
    license="MIT",
    entry_points={
        "console_scripts": [
            "simulated_joint_driver = mycobot_driver.simulated_joint_driver:main",
            "send_joint_command = mycobot_driver.send_joint_command:main",
        ],
    },
)
