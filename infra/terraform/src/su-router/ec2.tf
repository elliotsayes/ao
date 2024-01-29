locals {
  application_port = 9000
}

data "aws_secretsmanager_secret_version" "database_user_skeduser" {
  secret_id = "postgres-user-skeduser"
}

data "aws_ami" "latest_ami_id" {
  most_recent = true

  filter {
    name   = "name"
    values = ["su-testnet-*"]
  }

  owners = [var.principal_account_id]
}

resource "aws_security_group" "su_router_asg_cluster" {
  count       = var.enabled ? 1 : 0
  name        = "su-router-asg-cluster-sg"
  description = "Allow inbound traffic from the internet"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow inbound SSH in the private VPC"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Allow inbound HTTP traffic to su"
    from_port   = local.application_port
    to_port     = local.application_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow outbound traffic to the internet"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "su_router_asg_cluster_log_group" {
  count = var.enabled ? 1 : 0
  name  = "/ec2/su-router-asg-cluster"
}

resource "aws_launch_template" "su_router_asg_cluster_launch_template" {
  count         = var.enabled ? 1 : 0
  name          = "su-router-asg-cluster"
  image_id      = data.aws_ami.latest_ami_id.id
  instance_type = var.ec2_instance_type
  key_name      = "hlolli"


  network_interfaces {
    security_groups = [aws_security_group.su_router_asg_cluster.0.id]
  }

  monitoring {
    enabled = true
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.su_router_task_profile.0.name
  }

  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    region                   = var.region
    log_group_name           = aws_cloudwatch_log_group.su_router_asg_cluster_log_group.0.name
    gateway_url              = "https://arweave.net"
    upload_node_url          = "https://up.arweave.net"
    postgres_writer_instance = "postgresql://skeduser:${data.aws_secretsmanager_secret_version.database_user_skeduser.secret_string}@${var.psql_writer_instance_url}"
    application_port         = local.application_port
    su_units_count           = var.su_unit_count
  }))

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 5
      volume_type           = "gp2"
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = tomap({
      AoEnvironment = var.environment,
      AoServer      = "su"
    })
  }

  tag_specifications {
    resource_type = "volume"
    tags = tomap({
      AoEnvironment = var.environment,
      AoServer      = "su"
    })
  }

  tags = tomap({
    AoEnvironment = var.environment,
    AoServer      = "su"
  })

}

resource "aws_elb" "su_router_asg_cluster_elb" {
  count   = var.enabled ? 1 : 0
  name    = "su-router"
  subnets = var.public_subnet_ids

  # health_check {
  #   target              = "HTTP:${local.application_port}/"
  #   interval            = 30
  #   healthy_threshold   = 2
  #   unhealthy_threshold = 2
  #   timeout             = 5
  # }

  listener {
    instance_port     = local.application_port
    instance_protocol = "HTTP"
    lb_port           = local.application_port
    lb_protocol       = "HTTP"
  }

}

resource "aws_autoscaling_group" "su_asg_cluster" {
  count = var.enabled ? 1 : 0
  enabled_metrics = [
    "GroupDesiredCapacity",
    "GroupPendingInstances",
    "GroupInServiceInstances",
    "GroupTerminatingInstances",
    "GroupTotalInstances"
  ]

  load_balancers = [aws_elb.su_router_asg_cluster_elb.0.name]

  name                      = "su-router-asg-cluster"
  desired_capacity          = 2
  max_size                  = 3
  min_size                  = 1
  vpc_zone_identifier       = var.public_subnet_ids
  health_check_type         = "ELB"
  health_check_grace_period = 300
  wait_for_capacity_timeout = 0

  tag {
    key                 = "Name"
    value               = "su-router-asg-cluster"
    propagate_at_launch = true
  }

  launch_template {
    id      = aws_launch_template.su_router_asg_cluster_launch_template.0.id
    version = aws_launch_template.su_router_asg_cluster_launch_template.0.latest_version
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [launch_template]
  }

}

output "su_router_asg_cluster_elb_dns_name" {
  value = aws_elb.su_router_asg_cluster_elb.0.dns_name
}

output "su_router_asg_cluster_elb_zone_id" {
  value = aws_elb.su_router_asg_cluster_elb.0.zone_id
}
